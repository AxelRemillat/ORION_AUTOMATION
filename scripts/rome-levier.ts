/**
 * LEVIER ROME (Cowork #31) — LECTURE SEULE, gratuite : API France Travail sans cache (le
 * cache de l'app écrit en base), aucune fiche créée, aucun appel payant.
 *
 *   … rome-levier.js [--days 14]                       les codes suivis : offres lues → retenues → creusées → prêtes
 *   … rome-levier.js --candidats M1602,N1103 [--days 14] lecture à blanc de codes candidats (volume, part exploitable)
 *   … rome-levier.js --plafond                         runs dont la lecture France Travail a atteint 8 000 offres
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { accessToken, FT_RANGE_LIMIT, FUNNEL_FT_MAX_OFFERS, FUNNEL_ROME_CODES, looksLikeStaffingAgency } from "@/lib/signals/france-travail";

const BASE = "https://api.francetravail.io/partenaire/offresdemploi/v2";
const arg = (name: string) => (process.argv.indexOf(name) >= 0 ? process.argv[process.argv.indexOf(name) + 1] ?? null : null);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (date: Date) => `${date.toISOString().slice(0, 19)}Z`;
type Offer = { id?: string; dateCreation?: string; entreprise?: { nom?: string }; origineOffre?: { urlOrigine?: string } };

async function page(token: string, code: string, min: string, max: string, start: number): Promise<{ offers: Offer[]; total: number }> {
  const params = new URLSearchParams({ codeROME: code, minCreationDate: min, maxCreationDate: max, range: `${start}-${start + 149}`, sort: "1" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${BASE}/offres/search?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (response.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const total = Number((response.headers.get("content-range") ?? "").split("/")[1] ?? 0) || 0;
    if (response.status === 204 || !response.ok) return { offers: [], total };
    return { offers: ((await response.json()) as { resultats?: Offer[] }).resultats ?? [], total };
  }
  return { offers: [], total: 0 };
}

/** Toutes les offres d'un code sur la fenêtre (fenêtre glissante au-delà de 3 150). */
async function readCode(token: string, code: string, days: number): Promise<Offer[]> {
  const min = iso(new Date(Date.now() - days * 86_400_000));
  let max = iso(new Date());
  const out = new Map<string, Offer>();
  for (let slide = 0; slide < 6; slide += 1) {
    let last: string | null = null;
    let total = 0;
    for (let start = 0; start < FT_RANGE_LIMIT; start += 150) {
      const result = await page(token, code, min, max, start);
      total = result.total;
      for (const offer of result.offers) if (offer.id) out.set(offer.id, offer);
      last = result.offers.at(-1)?.dateCreation ?? last;
      await sleep(250);
      if (result.offers.length < 150) break;
    }
    if (total <= FT_RANGE_LIMIT || !last) break;
    max = iso(new Date(last));
  }
  return [...out.values()];
}

const usable = (offer: Offer) => Boolean(offer.entreprise?.nom) && !looksLikeStaffingAgency(offer.entreprise!.nom!);

async function tracked(token: string, days: number) {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  const since = new Date(Date.now() - (days + 2) * 86_400_000).toISOString();
  type Row = { url_source: string | null; statut: string; score: number | null; prospect_id: string | null };
  const rows = await readAll<Row>(() => table.from("signal_candidates").select("url_source, statut, score, prospect_id").eq("user_id", userId).eq("source", "france-travail").gte("created_at", since).order("id"));
  const byUrl = new Map(rows.filter((row) => row.url_source).map((row) => [row.url_source as string, row]));
  const ids = rows.map((row) => row.prospect_id).filter((id): id is string => Boolean(id));
  const ready = new Set<string>();
  for (let index = 0; index < ids.length; index += 200) {
    const { data } = await table.from("messages").select("prospect_id, quality_score, quality_reason, origin").in("prospect_id", ids.slice(index, index + 200)).eq("type", "intro").is("deleted_at", null);
    for (const draft of (data ?? []) as { prospect_id: string; quality_score: number | null; quality_reason: string | null; origin: string | null }[]) {
      if (!draft.origin && (draft.quality_score ?? 0) >= 9 && !draft.quality_reason) ready.add(draft.prospect_id);
    }
  }
  console.log(`code\tlues\texploitables\tfiches\tretenues(≥4)\tcreusées\tprêtes≥9`);
  const lines: string[] = [];
  for (const code of FUNNEL_ROME_CODES) {
    const offers = await readCode(token, code, days);
    const matched = offers
      .map((offer) => byUrl.get(offer.origineOffre?.urlOrigine ?? "") ?? byUrl.get(`https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`))
      .filter((row): row is Row => Boolean(row));
    const kept = matched.filter((row) => (row.score ?? 0) >= 4 || row.statut === "creusé").length;
    const dug = matched.filter((row) => row.statut === "creusé").length;
    const ok = matched.filter((row) => row.prospect_id && ready.has(row.prospect_id)).length;
    lines.push(`${code}\t${offers.length}\t${offers.filter(usable).length}\t${matched.length}\t${kept}\t${dug}\t${ok}`);
    console.log(lines.at(-1));
  }
}

async function candidates(token: string, codes: string[], days: number) {
  const metiers = (await (await fetch(`${BASE}/referentiel/metiers`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })).json()) as { code: string; libelle: string }[];
  const label = new Map(metiers.map((item) => [item.code, item.libelle]));
  console.log(`code\tlibellé\tlues/${days} j\texploitables`);
  for (const code of codes) {
    if (!label.has(code)) {
      console.log(`${code}\tABSENT DU RÉFÉRENTIEL`);
      continue;
    }
    const offers = await readCode(token, code, days);
    console.log(`${code}\t${label.get(code)}\t${offers.length}\t${offers.filter(usable).length}`);
  }
}

async function ceiling() {
  const table = db as never as { from: (t: string) => any };
  const { data } = await table.from("jobs").select("created_at, state").eq("type", "search_signals").gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).order("created_at");
  const runs = ((data ?? []) as { created_at: string; state: { harvest?: { ft?: { read?: number } } } | null }[]).map((job) => ({ at: job.created_at.slice(0, 16), read: job.state?.harvest?.ft?.read ?? null })).filter((run) => run.read !== null);
  const hit = runs.filter((run) => (run.read ?? 0) >= FUNNEL_FT_MAX_OFFERS);
  console.log(`${runs.length} run(s) avec lecture France Travail sur 30 j · ${hit.length} au plafond de ${FUNNEL_FT_MAX_OFFERS} · max ${Math.max(0, ...runs.map((run) => run.read ?? 0))}`);
  for (const run of runs) console.log(`  ${run.at}\t${run.read}`);
}

async function main() {
  const days = Math.max(1, Number(arg("--days")) || 14);
  if (process.argv.includes("--plafond")) return ceiling().then(() => process.exit(0));
  const auth = await accessToken();
  if (!auth.ok) throw new Error("France Travail : identifiants indisponibles");
  const list = arg("--candidats");
  if (list) await candidates(auth.data, list.split(",").map((code) => code.trim()).filter(Boolean), days);
  else await tracked(auth.data, days);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
