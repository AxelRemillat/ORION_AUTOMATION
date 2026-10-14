/**
 * RATTRAPAGE GRATUIT DES « SANS SITE » (Cowork #30) — SIMULATION PAR DÉFAUT, 0 €.
 *
 * Fiches rejetées « Sans site » (score de tri ≥ 4, 14 jours, sans fiche prospect) :
 *   1. domaine déjà connu ailleurs (e-mail ou site de l'annuaire) ;
 *   2. domaines déduits du nom (lib/funnel/free-site-recovery.ts), filtrés par le DNS ;
 *   3. robots.txt respecté, puis UNE lecture de la page d'accueil, user-agent honnête ;
 *   4. site gardé seulement si la correspondance est sûre (nom + SIREN ou ville).
 * Ni Linkup, ni Hunter, ni Pappers, ni modèle.
 *
 *   … sans-site-gratuit.js                simulation : combien, échantillon
 *   … sans-site-gratuit.js --appliquer    les fiches sûres reviennent « retenu », site trouvé
 */
import { promises as dns } from "node:dns";
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { matchHomepage, recoveryDomains, robotsForbidsHome, type RecoveryCompany } from "@/lib/funnel/free-site-recovery";

const UA = "ORION-prospection/1.0 (recherche du site officiel d'une entreprise ; une page par domaine ; +https://axelremillat.com)";
const apply = process.argv.includes("--appliquer");
export const RECOVERY_TRACE = "site retrouvé gratuitement (Cowork #30)";

type Base = { siren?: string; city?: string; postal_code?: string; company_name?: string; website?: string | null; email?: string | null };
type Row = { id: string; company_name: string | null; score: number | null; contact: Record<string, unknown> | null; identity: { name?: string; base?: Base } | null };

async function get(url: string): Promise<{ status: number; url: string; text: string } | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    return { status: response.status, url: response.url, text: (await response.text()).slice(0, 400_000) };
  } catch {
    return null;
  }
}

const resolves = (domain: string) =>
  dns.resolve4(domain).then((list) => list.length > 0, () => dns.resolveCname(domain).then((list) => list.length > 0, () => false));

async function recover(row: Row) {
  const base = row.identity?.base ?? {};
  const company: RecoveryCompany = {
    names: [...new Set([row.company_name, base.company_name, row.identity?.name].filter((name): name is string => Boolean(name)))],
    siren: base.siren ?? null,
    city: base.city ?? null,
    postalCode: base.postal_code ?? null,
  };
  const known = [base.website, base.email?.split("@")[1]].filter((value): value is string => Boolean(value)).map((value) => value.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  const tried: string[] = [];
  for (const domain of [...new Set([...known, ...recoveryDomains(company)])]) {
    if (!(await resolves(domain))) continue;
    tried.push(domain);
    const robots = await get(`https://${domain}/robots.txt`);
    if (robots && robots.status === 200 && robotsForbidsHome(robots.text)) continue;
    const home = await get(`https://${domain}/`);
    if (!home || home.status >= 400) continue;
    const verdict = matchHomepage(home.text, company);
    if (verdict.sure) return { domain, website: `https://${domain}`, by: verdict.by, tried };
  }
  return { domain: null, website: null, by: null, tried };
}

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const rows = (
    await readAll<Row>(() =>
      table.from("signal_candidates").select("id, company_name, score, contact, identity").eq("user_id", userId).eq("statut", "rejeté").like("motif_rejet", "Sans site%").gte("score", 4).is("prospect_id", null).gte("created_at", since).order("id"),
    )
  ).filter((row) => row.identity);
  console.log(`${rows.length} fiche(s) « Sans site » (score ≥ 4, 14 j)${apply ? "" : " — SIMULATION, rien n'est écrit"}`);
  const found: { row: Row; website: string; by: string }[] = [];
  let resolved = 0;
  for (let index = 0; index < rows.length; index += 4) {
    const batch = rows.slice(index, index + 4);
    const results = await Promise.all(batch.map(recover));
    results.forEach((result, offset) => {
      resolved += result.tried.length;
      if (result.website) found.push({ row: batch[offset], website: result.website, by: result.by! });
    });
  }
  console.log(`${resolved} domaine(s) candidats existants lus · ${found.length} site(s) retrouvé(s) avec correspondance sûre\n`);
  for (const item of found) console.log(`· ${item.row.company_name} (score ${item.row.score}, ${item.row.identity?.base?.city ?? "?"}) → ${item.website} [${item.by}]`);
  if (!apply) return process.exit(0);
  let done = 0;
  for (const item of found) {
    const contact = { ...(item.row.contact ?? {}), site_free: { website: item.website, checked_at: new Date().toISOString() }, reprise: RECOVERY_TRACE };
    const { error } = await table.from("signal_candidates").update({ statut: "retenu", motif_rejet: null, contact }).eq("id", item.row.id).eq("statut", "rejeté");
    if (!error) done += 1;
  }
  console.log(`\n${done} fiche(s) remise(s) en file avec leur site.`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
