/**
 * EXPLORATION DES CODES ROME (Cowork #46) — lecture gratuite de l'API France
 * Travail : libellés officiels (/referentiel/metiers) et volume d'offres.
 *
 *   npm run rome:explore -- --search "commande,factur"   → codes dont le libellé contient un des mots
 *   npm run rome:explore -- --count D1409,M1607 [--days 30] → offres publiées sur la fenêtre, part nommée hors intermédiaires
 *
 * Aucune écriture en base.
 */
import "./quality-live";
import { accessToken, FUNNEL_ROME_CODES } from "@/lib/signals/france-travail";

const BASE = "https://api.francetravail.io/partenaire/offresdemploi/v2";
const value = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = (date: Date) => `${date.toISOString().slice(0, 19)}Z`;

async function get(url: string, token: string): Promise<Response> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (response.status !== 429) return response;
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`429 persistant : ${url}`);
}

type Offer = { entreprise?: { nom?: string }; intitule?: string };

async function main() {
  const auth = await accessToken();
  if (!auth.ok) throw new Error("France Travail : identifiants indisponibles");
  const token = auth.data;
  const search = value("--search");
  const count = value("--count");
  const metiers = (await (await get(`${BASE}/referentiel/metiers`, token)).json()) as { code: string; libelle: string }[];
  const label = new Map(metiers.map((item) => [item.code, item.libelle]));
  if (search) {
    const words = search.split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
    for (const item of metiers.filter((m) => words.some((word) => m.libelle.toLowerCase().includes(word)))) {
      console.log(`${item.code}\t${item.libelle}${(FUNNEL_ROME_CODES as readonly string[]).includes(item.code) ? "\t(déjà suivi)" : ""}`);
    }
  }
  if (count) {
    const days = Math.max(1, Number(value("--days")) || 30);
    const min = iso(new Date(Date.now() - days * 86_400_000));
    const max = iso(new Date());
    for (const code of count.split(",").map((c) => c.trim()).filter(Boolean)) {
      if (!label.has(code)) {
        console.log(`${code}\tABSENT DU RÉFÉRENTIEL`);
        continue;
      }
      const params = new URLSearchParams({ codeROME: code, minCreationDate: min, maxCreationDate: max, range: "0-149" });
      const response = await get(`${BASE}/offres/search?${params}`, token);
      const total = Number((response.headers.get("content-range") ?? "").split("/")[1] ?? 0) || 0;
      const offers = response.status === 204 ? [] : (((await response.json()) as { resultats?: Offer[] }).resultats ?? []);
      const named = offers.filter((offer) => offer.entreprise?.nom && !/int[eé]rim|recrutement|staffing|adecco|manpower|randstad|synergie|crit\b|proman|start people|samsic emploi|partnaire|supplay|actual/i.test(offer.entreprise.nom)).length;
      console.log(`${code}\t${label.get(code)}\t${total} offres / ${days} j\tnommées hors intermédiaires ${offers.length ? Math.round((named / offers.length) * 100) : 0} % (sur ${offers.length})`);
      await sleep(400);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
