/**
 * Faits distinctifs sourcés (Cowork #34) — fixtures : faux site, faux modèle,
 * fausse base. Aucun appel réseau, aucun coût.
 * `npm run test:faits`
 */
import { extractFacts, factPages, factsScore, normalizeForQuote, validateFacts, type FactPage } from "../lib/enrichment/facts";
import { ensureFacts } from "../lib/enrichment/facts-server";
import type { Db } from "../lib/trash/scope";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const HOME = `<html><body>
  <nav><a href="/nos-produits">Nos produits</a><a href="/references">Nos clients</a><a href="/actualites">Actualités</a>
  <a href="/recrutement">Recrutement</a><a href="/mentions-legales">Mentions légales</a><a href="https://facebook.com/acme">FB</a></nav>
  <p>ACME Emballages fabrique des cartons sur mesure pour l'industrie agroalimentaire depuis 1987.</p>
</body></html>`;
const PAGES: Record<string, string> = {
  "https://acme.fr": HOME,
  "https://acme.fr/nos-produits": `<p>Chaque devis est chiffré sous 48 h à partir de vos plans et de vos quantités, du prototype à la série.</p><p>Nous sommes une entreprise dynamique à votre écoute.</p>`,
  "https://acme.fr/references": `<p>Ils nous font confiance : Bonduelle, Lactalis et 300 PME de la région Hauts-de-France.</p>`,
  "https://acme.fr/actualites": `<p>Nouvelle ligne d'impression numérique installée sur notre site de Lens en 2025.</p>`,
  "https://acme.fr/recrutement": `<p>Assistant(e) ADV : vous saisissez les commandes reçues par e-mail et suivez les livraisons de nos 3 dépôts.</p>`,
};

function fakeSite() {
  const read: string[] = [];
  return {
    read,
    fetchHtml: async (url: string) => {
      read.push(url);
      const html = PAGES[url.replace(/\/$/, "")];
      return html ? { html, url } : null;
    },
  };
}

const MODEL_ANSWER = JSON.stringify({
  facts: [
    { quote: "Chaque devis est chiffré sous 48 h à partir de vos plans et de vos quantités", source_url: "https://acme.fr/nos-produits", page_kind: "produits", distinctiveness: 3, process_hint: "chiffrage des devis sur plans" },
    { quote: "vous saisissez les commandes reçues par e-mail et suivez les livraisons de nos 3 dépôts", source_url: "https://acme.fr/recrutement", page_kind: "recrutement", distinctiveness: 2, process_hint: "saisie des commandes reçues par e-mail" },
    { quote: "Bonduelle, Lactalis et 300 PME de la région Hauts-de-France", source_url: "https://acme.fr/references", page_kind: "references", distinctiveness: 1, process_hint: null },
    { quote: "Nous livrons 12 000 palettes par an à Carrefour", source_url: "https://acme.fr/references", page_kind: "references", distinctiveness: 3, process_hint: "logistique" },
    { quote: "Nous sommes une entreprise dynamique à votre écoute", source_url: "https://acme.fr/nos-produits", page_kind: "produits", distinctiveness: 2, process_hint: null },
  ],
});

async function main() {
  console.log("\n1. Pages lues");
  {
    const pages = factPages(HOME, "https://acme.fr");
    const kinds = pages.map((page) => page.kind);
    check("produits, références, actualités, recrutement : une page par famille", ["produits", "references", "actualites", "recrutement"].every((kind) => kinds.includes(kind as never)), pages);
    check("mentions légales et réseaux sociaux écartés", !pages.some((page) => /mentions|facebook/.test(page.url)), pages);
  }

  console.log("\n2. Garde-fou : rien d'inventé");
  {
    const pages: FactPage[] = Object.entries(PAGES).map(([url, html]) => ({ url, kind: "autre", text: html.replace(/<[^>]+>/g, " ") }));
    const facts = validateFacts(MODEL_ANSWER, pages);
    const texts = facts.map((fact) => fact.text);
    check("extrait absent de sa page (« 12 000 palettes … Carrefour ») : rejeté", !texts.some((text) => text.includes("Carrefour")), texts);
    check("fait générique sans process : plafonné à 1", facts.find((fact) => fact.text.startsWith("Nous sommes"))?.distinctiveness === 1, facts);
    check("4 faits gardés, triés du plus distinctif au moins distinctif", facts.length === 4 && facts[0].distinctiveness === 3, facts.map((fact) => fact.distinctiveness));
    check("facts_score = max(distinctiveness) = 3", factsScore(facts) === 3);
    check("JSON illisible : aucun fait", validateFacts("pas du json", pages).length === 0);
    check("comparaison tolérante (accents, apostrophes, espaces)", normalizeForQuote("L’Équipe  ADV") === normalizeForQuote("l'equipe adv"));
  }

  console.log("\n3. Extraction complète + écriture fusionnée");
  {
    const site = fakeSite();
    const asked: string[] = [];
    const deps = { fetchHtml: site.fetchHtml, ask: async (_system: string, user: string) => { asked.push(user); return MODEL_ANSWER; } };
    const run = await extractFacts("ACME", "acme.fr", deps);
    check("accueil + 4 pages lues, un seul appel de modèle", site.read.length === 5 && asked.length === 1, site.read);
    check("faits sourcés, score 3", run.score === 3 && run.facts.every((fact) => fact.source_url.startsWith("https://acme.fr")), run);

    const fake = new FakeDb({ prospects: [{ id: "p1", company_name: "ACME", website: "acme.fr", key_figures: { leader_person: "Jean DUPONT", civilites: { jean: "M" } } }] } as Record<string, Record<string, unknown>[]>);
    const prospect = { id: "p1", company_name: "ACME", website: "acme.fr", key_figures: { leader_person: "Jean DUPONT" } as Record<string, unknown> };
    await ensureFacts(fake as unknown as Db, prospect, { deps, now: new Date("2026-10-06T20:00:00Z") });
    const figures = fake.rows("prospects")[0].key_figures as Record<string, unknown>;
    check("écrit : facts, facts_score, facts_at, facts_version", Array.isArray(figures.facts) && figures.facts_score === 3 && figures.facts_at === "2026-10-06T20:00:00.000Z" && figures.facts_version === 1, figures);
    check("rien d'effacé (civilites, leader_person conservés)", figures.leader_person === "Jean DUPONT" && Boolean(figures.civilites), figures);
    const again = await ensureFacts(fake as unknown as Db, { ...prospect, key_figures: figures }, { deps, now: new Date("2026-10-07T08:00:00Z") });
    check("relus du cache (moins de 30 jours) : aucun nouvel appel", again?.note === "cache" && asked.length === 2, asked.length);

    const none = await ensureFacts(fake as unknown as Db, { id: "p2", company_name: "SANS SITE", website: null, key_figures: {} }, { deps });
    check("sans site : rien n'est écrit (absence = jamais extrait)", none === null);
    const dead = { fetchHtml: async () => null, ask: async () => "{}" };
    const fake2 = new FakeDb({ prospects: [{ id: "p3", key_figures: { a: 1 } }] } as Record<string, Record<string, unknown>[]>);
    const unreadable = await ensureFacts(fake2 as unknown as Db, { id: "p3", company_name: "MORT", website: "mort.fr", key_figures: { a: 1 } }, { deps: dead });
    const written = fake2.rows("prospects")[0].key_figures as Record<string, unknown>;
    check("site illisible : facts [] + motif, score 0, champs conservés", unreadable?.note === "site illisible" && Array.isArray(written.facts) && (written.facts as unknown[]).length === 0 && written.facts_score === 0 && written.a === 1, written);
  }

  console.log(failures === 0 ? "\nTous les tests des faits distinctifs passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
