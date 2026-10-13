/**
 * TEST CIBLÉ (Cowork #6) : un fait singulier débloque-t-il C1 ?
 *
 * Les 5 agences qualifiées échouent toutes sur C1, le test de substitution :
 * « vous proposez la création de sites Internet aux artisans » reste vrai pour
 * dix agences. La cause est en amont du rédacteur — `pickSecondaryPages` ne
 * retient que « à propos » et « services », jamais « réalisations » ni
 * « références ». Le pipeline ne lit donc JAMAIS la seule page qui porte un
 * fait singulier : le portfolio.
 *
 * Ce script lit ces pages sur les sites déjà connus, en extrait un fait sourcé
 * (citation + URL), l'écrit en tête des faits de la fiche, régénère le
 * brouillon F5 en origin « eval » et le soumet au juge commun.
 *
 *   npm run faits:agences
 *
 * Aucune recherche web (`withLinkupRun` à cap 0 : le cache répond, rien ne
 * part), aucun crédit Hunter, aucun envoi.
 */
import { createClient } from "@supabase/supabase-js";
import { scriptJobSource } from "@/lib/jobs/regen-cap";
import { judgeChecklist } from "@/lib/emails/quality/checklist";
import { countedText } from "@/lib/mail-preflight/words";
import { checkF5 } from "@/lib/segments/mail-f5";
import { withLinkupRun } from "@/lib/linkup/run-cap";
import { internalLinks } from "@/lib/enrichment/site";
import { liveAsk } from "./quality-live";

const NAMES = ["AGENCE JB", "FOURMIZZ COMMUNICATION", "SAINT LOUIS CONSEIL", "CONVERSATIONNEL", "DC AGENCY"];

/** Les pages qui portent un fait singulier — celles que le pipeline ne lit pas. */
const PORTFOLIO =
  /\b(r[ée]alisations?|r[ée]f[ée]rences?|portfolio|nos\s+clients?|clients?|projets?|[ée]tudes?\s+de\s+cas|cas\s+clients?|travaux|book)\b/i;

const flag = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const OPENAI_CAP = Number(flag("openai-cap", "0.17")) || 0.17;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");
const db = createClient(url, key, { auth: { persistSession: false } });

const since = new Date().toISOString();

async function spentOpenAi(userId: string): Promise<number> {
  const { data } = await db
    .from("api_usage")
    .select("cost")
    .eq("user_id", userId)
    .eq("service", "openai")
    .gte("created_at", since);
  return ((data ?? []) as { cost: unknown }[]).reduce((total, row) => total + (Number(row.cost) || 0), 0);
}

/** Texte lisible d'une page : on retire le script, le style et les balises. */
function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rend le HTML ET l'URL EFFECTIVE apres redirections.
 *
 * C'est indispensable : fourmizz.fr, saintlouisconseil.fr et
 * conversationnel.fr renvoient tous un 301 vers `www.`. En gardant le domaine
 * nu comme origine, `internalLinks` juge EXTERNE chaque lien du site et n'en
 * retient aucun — zero page de realisations sur trois agences sur cinq.
 */
async function fetchHtml(target: string): Promise<{ html: string; url: string } | null> {
  try {
    const response = await fetch(target, {
      headers: { Accept: "text/html", "User-Agent": "ORION/1.0 (prospection; axelremillat.com)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return { html: await response.text(), url: response.url || target };
  } catch {
    return null;
  }
}

interface Found {
  name: string;
  prospectId: string;
  website: string;
  pages: { url: string; text: string }[];
}

/** Les pages de réalisations du site DÉJÀ CONNU. Aucune recherche web. */
async function portfolioPages(website: string): Promise<Found["pages"] | null> {
  const home = await fetchHtml(website.replace(/\/+$/, ""));
  // `null` = la page d'accueil elle-meme n'a pas repondu. Ce n'est pas la meme
  // chose qu'un site sans page de realisations, et le rapport doit le dire.
  if (!home) return null;
  // L'origine est celle de la page REELLEMENT servie, redirections comprises.
  const origin = new URL(home.url).origin;
  const links = internalLinks(home.html, origin);
  const targets = links
    .filter((link) => PORTFOLIO.test(link.label) || PORTFOLIO.test(link.href))
    .map((link) => link.href)
    .filter((href, index, all) => all.indexOf(href) === index)
    .slice(0, 3);

  const pages: Found["pages"] = [];
  for (const target of targets) {
    const page = await fetchHtml(target);
    if (!page) continue;
    const text = plainText(page.html);
    if (text.length > 200) pages.push({ url: target, text: text.slice(0, 6000) });
  }
  return pages;
}

const EXTRACT_SYSTEM = `Tu lis les pages « réalisations / références / clients » du site d'une agence web ou de communication, et tu en extrais UN SEUL fait SINGULIER.

Un fait singulier distingue CETTE agence de dix concurrentes du même métier :
  - un client NOMMÉ (« le site de la Caisse d'Épargne Aquitaine ») ;
  - une réalisation précise, mieux si elle est datée ou chiffrée ;
  - un outil ou une méthode MAISON, portant un nom.

N'est PAS un fait singulier : une activité (« création de sites »), une
clientèle générique (« artisans et PME »), une valeur (« proximité »), un
chiffre d'équipe, un formulaire, un intitulé de page.

Réponds UNIQUEMENT en JSON :
{"fait": "le fait en une phrase, au présent, sans superlatif",
 "citation": "la phrase EXACTE copiée de la page, 25 mots au plus",
 "url": "l'URL de la page qui la porte",
 "singulier": true|false}

« singulier » est false si les pages ne portent aucun fait de ce genre : ne
l'invente jamais, et laisse alors les autres champs vides.`;

interface Fact {
  fait: string;
  citation: string;
  url: string;
  singulier: boolean;
}

async function extractFact(found: Found, userId: string): Promise<Fact | null> {
  const user = `AGENCE : ${found.name}\nSITE : ${found.website}\n\n${found.pages
    .map((page) => `--- ${page.url}\n${page.text}`)
    .join("\n\n")}`;
  const raw = await liveAsk(found.prospectId)("judge", EXTRACT_SYSTEM, user, 0, "agences:fait-singulier").catch(
    () => null,
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "")) as Fact;
    return parsed.singulier ? parsed : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { data: userRow } = await db.from("prospects").select("user_id").limit(1).maybeSingle();
  const userId = (userRow as { user_id: string } | null)?.user_id;
  if (!userId) throw new Error("aucun prospect en base : user_id introuvable");
  process.env.ORION_SCRIPT_USER_ID = userId;

  // La signature est posee par le code : la grille doit la retirer avant de
  // compter les mots et les liens de demo (cf. lib/segments/mail-f5.ts).
  const { loadOffer } = await import("@/lib/offer/read");
  const { signatureFor } = await import("@/lib/offer/model");
  const signature = signatureFor((await loadOffer(db as never, userId)).offer);

  const { data } = await db
    .from("prospects")
    .select("id, company_name, website, key_figures")
    .in("company_name", NAMES);
  const rows = (data ?? []) as { id: string; company_name: string; website: string | null; key_figures: Record<string, unknown> | null }[];

  console.log(`${rows.length} agence(s) en base sur ${NAMES.length} attendues.\n`);

  const results: { name: string; fact: Fact | null; subject: string; body: string; verdict: string; score: number | null }[] =
    [];

  for (const row of rows) {
    console.log(`=== ${row.company_name}`);
    if (!row.website) {
      console.log("  pas de site connu");
      results.push({ name: row.company_name, fact: null, subject: "", body: "", verdict: "pas de site", score: null });
      continue;
    }

    // --- 1. Les pages que le pipeline ne lit pas ---------------------------
    const pages = await portfolioPages(row.website);
    if (pages === null) {
      console.log(`  page d'accueil injoignable : ${row.website}`);
      results.push({ name: row.company_name, fact: null, subject: "", body: "", verdict: "site injoignable depuis ce poste", score: null });
      continue;
    }
    console.log(`  pages de réalisations lues : ${pages.length}${pages.length ? ` (${pages.map((p) => p.url).join(", ")})` : ""}`);
    if (!pages.length) {
      results.push({ name: row.company_name, fact: null, subject: "", body: "", verdict: "aucune page de réalisations liée depuis l'accueil", score: null });
      continue;
    }

    // --- 2. Un fait singulier, sourcé -------------------------------------
    const fact = await extractFact({ name: row.company_name, prospectId: row.id, website: row.website, pages }, userId);
    if (!fact) {
      console.log("  aucun fait singulier dans ces pages");
      results.push({ name: row.company_name, fact: null, subject: "", body: "", verdict: "aucun fait singulier", score: null });
      continue;
    }
    console.log(`  fait : ${fact.fait}`);
    console.log(`  cité : « ${fact.citation} » — ${fact.url}`);

    // --- 3. Le fait passe en TÊTE des faits de la fiche -------------------
    const figures = (row.key_figures ?? {}) as Record<string, unknown>;
    const previous = Array.isArray(figures.facts) ? (figures.facts as unknown[]) : [];
    await db
      .from("prospects")
      .update({
        key_figures: {
          ...figures,
          /*
           * LA FORME COMPTE. `keyFactsOf` (lib/emails/quality/facts-gate.ts)
           * exige `text`, `source_url` ET un `distinctiveness` numerique : un
           * fait sans ces champs est jete AVANT d'atteindre le redacteur. Mon
           * premier essai passait `{text, url, source}` — le fait Exosens etait
           * en base et le mail ouvrait quand meme sur la description
           * d'activite, d'ou un C1=NON qui ne jugeait pas l'hypothese.
           */
          facts: [
            {
              text: fact.fait,
              source_url: fact.url,
              page_kind: "realisations",
              distinctiveness: 3,
              process_hint: null,
            },
            ...previous,
          ],
        },
      })
      .eq("id", row.id);

    const spent = await spentOpenAi(userId);
    if (spent >= OPENAI_CAP) {
      console.log(`  plafond OpenAI atteint (${spent.toFixed(4)} €)`);
      results.push({ name: row.company_name, fact, subject: "", body: "", verdict: "plafond OpenAI", score: null });
      continue;
    }

    // --- 4. Régénération en origin « eval », puis juge commun -------------
    const { EMPTY_PROGRESS } = await import("@/lib/jobs/types");
    const { data: jobRow, error: jobError } = await db
      .from("jobs")
      .insert({
        user_id: userId,
        type: "email_generate",
        status: "queued",
        progress: EMPTY_PROGRESS,
        target: { prospectId: row.id, label: `Agences fait · ${row.company_name}`.slice(0, 160) },
        params: { prospectId: row.id, segment: "agences", origin: "eval", force: true, ...scriptJobSource() },
      } as never)
      .select("id")
      .single();
    const jobId = (jobRow as { id: string } | null)?.id;
    if (!jobId) {
      const why = `job non créé : ${jobError?.message ?? "sans message"}`;
      console.log(`  ${why}`);
      results.push({ name: row.company_name, fact, subject: "", body: "", verdict: why, score: null });
      continue;
    }
    const { HANDLERS } = await import("@/lib/jobs/handlers");
    const { driveJob } = await import("@/lib/jobs/runner");
    const final = await driveJob(db as never, jobId, HANDLERS, 240_000);
    if (!final || final.status !== "done") {
      const why = `génération : ${final?.error ?? final?.status ?? "sans réponse"}`;
      console.log(`  ${why}`);
      results.push({ name: row.company_name, fact, subject: "", body: "", verdict: why, score: null });
      continue;
    }

    // Le brouillon vit dans `messages`, et son id vient du resultat du job.
    const messageId = (final.result as { messageId?: string } | null)?.messageId;
    const { data: draft } = messageId
      ? await db.from("messages").select("subject, body").eq("id", messageId).maybeSingle()
      : { data: null };
    const mail = draft as { subject: string | null; body: string } | null;
    if (!mail) {
      console.log("  brouillon introuvable");
      results.push({ name: row.company_name, fact, subject: "", body: "", verdict: "brouillon introuvable", score: null });
      continue;
    }

    const deterministic = checkF5({
      subject: mail.subject ?? "",
      body: mail.body,
      signature,
      facts: [{ label: fact.fait, url: fact.url }],
    });
    const checklist = await judgeChecklist(
      liveAsk(row.id),
      {
        subject: mail.subject ?? "",
        core: countedText(mail.body, signature),
        family: "F5",
        greeting: mail.body.split("\n")[0] ?? "",
        company: row.company_name,
        facts: `- ${fact.fait} (${fact.url})`,
        siteText: fact.citation,
      },
      "agences:fait-checklist",
    );
    const verdict = !deterministic.ready
      ? `déterministe : ${deterministic.failed.map((item) => item.id).join(", ")}`
      : checklist === null
        ? "relecture indisponible"
        : checklist.items
            .map((item) => `${item.id}=${item.ok ? "OUI" : "NON"}`)
            .join(" · ");
    console.log(`  verdict : ${verdict}${checklist ? ` (${checklist.score}/10)` : ""}`);
    results.push({
      name: row.company_name,
      fact,
      subject: mail.subject ?? "",
      body: mail.body,
      verdict,
      score: checklist?.score ?? null,
    });
  }

  // --- Rapport --------------------------------------------------------------
  console.log("\n\n## Résultat\n");
  const withFact = results.filter((item) => item.fact).length;
  const c1 = results.filter((item) => /C1=OUI/.test(item.verdict)).length;
  const ready = results.filter((item) => item.score === 10).length;
  console.log(`Faits singuliers trouvés : ${withFact}/${results.length}`);
  console.log(`C1 à OUI : ${c1}/${results.length}`);
  console.log(`Mails prêts (10/10) : ${ready}/${results.length}`);
  console.log(`Coût OpenAI : ${(await spentOpenAi(userId)).toFixed(4)} €\n`);

  for (const item of results) {
    console.log(`\n### ${item.name}`);
    if (item.fact) {
      console.log(`- fait : ${item.fact.fait}`);
      console.log(`- citation : « ${item.fact.citation} »`);
      console.log(`- source : ${item.fact.url}`);
    }
    console.log(`- verdict : ${item.verdict}${item.score !== null ? ` (${item.score}/10)` : ""}`);
    if (item.body) console.log(`\n\`\`\`\nObjet : ${item.subject}\n\n${item.body}\n\`\`\``);
  }
}

/* Aucune recherche web : cap à 0. Le cache répond, rien de neuf ne part. */
withLinkupRun({ segment: "agences", cap: 0, since: new Date() }, main).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
