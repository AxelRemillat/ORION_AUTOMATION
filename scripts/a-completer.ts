/**
 * FICHES « À COMPLÉTER » (Cowork #33) — LECTURE SEULE, 0 € : aucune écriture en base, aucun
 * appel payant (Hunter reste à agent1).
 *
 *   1. le groupe « À compléter » d'Aujourd'hui, ventilé par étiquette bloquante ;
 *   2. pour chaque fiche « Email manquant » avec un site : robots.txt, puis 3 pages au plus
 *      (accueil + contact + mentions légales, choisies comme l'étape e-mail), user-agent honnête ;
 *   3. classement : e-mail visible sur le site (gratuit) · domaine connu sans e-mail (Hunter,
 *      agent1) · non récupérable (pas de site, site illisible ou interdit).
 *
 *   … a-completer.js
 */
import { db, ownerId } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { extractEmails } from "@/lib/contact-finder/extract";
import { pagesToVisit } from "@/lib/contact-finder/links";
import { robotsForbidsHome } from "@/lib/funnel/free-site-recovery";
import { decodeCfEmails } from "@/lib/contact-finder/cloudflare";

const UA = "ORION-prospection/1.0 (lecture des coordonnées publiques d'une entreprise ; 3 pages au plus ; +https://axelremillat.com)";

async function get(url: string): Promise<{ status: number; text: string } | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    return { status: response.status, text: (await response.text()).slice(0, 600_000) };
  } catch {
    return null;
  }
}

const hasForm = (html: string) => /<form[\s\S]*?(<textarea|type=["']?email)/i.test(html);
const jsOnly = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length < 300;

type Verdict = { class: "gratuit" | "hunter" | "non récupérable"; detail: string; emails: string[] };

async function inspect(website: string): Promise<Verdict> {
  const origin = (() => {
    try {
      return new URL(website.startsWith("http") ? website : `https://${website}`).origin;
    } catch {
      return null;
    }
  })();
  if (!origin) return { class: "non récupérable", detail: "site illisible (URL)", emails: [] };
  const robots = await get(`${origin}/robots.txt`);
  if (robots?.status === 200 && robotsForbidsHome(robots.text)) return { class: "non récupérable", detail: "robots.txt interdit", emails: [] };
  const home = await get(`${origin}/`);
  if (!home || home.status >= 400) return { class: "non récupérable", detail: `site injoignable (${home?.status ?? "réseau"})`, emails: [] };
  const pages = [home.text];
  for (const url of pagesToVisit(home.text, origin, 2)) {
    const page = await get(url);
    if (page && page.status < 400) pages.push(page.text);
  }
  const plain = [...new Set(pages.flatMap((html) => extractEmails(html)))];
  const cloudflare = [...new Set(pages.flatMap(decodeCfEmails))].filter((email) => !plain.includes(email));
  if (plain.length) return { class: "gratuit", detail: "e-mail en clair sur le site", emails: plain };
  if (cloudflare.length) return { class: "gratuit", detail: "e-mail protégé Cloudflare (non décodé par l'étape)", emails: cloudflare };
  const form = pages.some(hasForm);
  const js = jsOnly(home.text);
  return { class: "hunter", detail: `${form ? "formulaire" : "ni e-mail ni formulaire"}${js ? ", site rendu en JavaScript" : ""}`, emails: [] };
}

async function main() {
  const userId = await ownerId();
  const items = flatten((await loadToday(db as never, userId)).groups).filter((item) => item.kind === "a_completer");
  const tags: Record<string, number> = {};
  for (const item of items) for (const tag of item.tags) tags[tag] = (tags[tag] ?? 0) + 1;
  const noEmail = items.filter((item) => item.tags.includes("Email manquant"));
  console.log(`« À compléter » : ${items.length} fiche(s) · dont « Email manquant » : ${noEmail.length}`);
  console.log(`Étiquettes : ${JSON.stringify(Object.entries(tags).sort((a, b) => b[1] - a[1]))}\n`);
  const rows: { name: string; website: string | null; attempts: number; verdict: Verdict }[] = [];
  for (const item of noEmail) {
    const verdict = item.website ? await inspect(item.website) : { class: "non récupérable" as const, detail: "pas de site", emails: [] };
    rows.push({ name: item.companyName, website: item.website, attempts: item.attempts, verdict });
  }
  const by: Record<string, number> = {};
  for (const row of rows) by[`${row.verdict.class} · ${row.verdict.detail}`] = (by[`${row.verdict.class} · ${row.verdict.detail}`] ?? 0) + 1;
  console.log("Classement des « Email manquant » :");
  for (const [key, count] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(3)}  ${key}`);
  console.log("");
  for (const row of rows) console.log(`· ${row.name} | ${row.website ?? "—"} | tentatives ${row.attempts} | ${row.verdict.class} : ${row.verdict.detail}${row.verdict.emails.length ? ` → ${row.verdict.emails.join(", ")}` : ""}`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
