/**
 * Compte rendu de recherche du module contact + nom en double. Aucun réseau.
 *
 *   - GLOBAL 2F (833040736) : pas de site. Les recherches ne rendent que des
 *     annuaires ; le compte rendu doit le dire, et conclure « probablement pas
 *     de site ». Son nom arrivait en double : « GLOBAL 2F (GLOBAL 2F) ».
 *   - BRIOL DIFFUSION (421882440) : site trouvé par le SIREN, adresse chez
 *     Hunter. Le compte rendu doit citer la requête exacte, les pages lues et
 *     les appels Hunter, en 10 lignes au plus.
 *
 * Fixtures de #37 (scripts/fixtures/contact-finder). Exécution : `npm run test:contact-report`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { runContactSearch, type ContactDeps, type HunterHit, type VerifierStatus } from "../lib/contact-finder/finder";
import { MAX_REPORT_LINES, searchReport, type StoredSearch } from "../lib/contact-finder/report";
import { exclusionReason } from "../lib/contact-finder/domains";
import { findContact, lookedFor, searchCost, storedSearch } from "../lib/contact-finder";
import type { CompanyIdentity } from "../lib/contact-finder/types";
import { singleCompanyName } from "../lib/company-name";
import { displayCompanyName } from "../lib/enrichment/entity-match";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const FIX = "scripts/fixtures/contact-finder";

/** Rejoue un cas enregistré : identité, recherches, pages (nu et « www. »). */
function replay(dir: string, host: string | null, hunter: { domainSearch?: Record<string, HunterHit[]>; verify?: Record<string, VerifierStatus> } = {}) {
  const meta = JSON.parse(readFileSync(`${FIX}/${dir}/search.json`, "utf8")) as {
    identity: CompanyIdentity;
    searches: { query: string; results: { url: string; title: string; snippet: string }[] }[];
  };
  const pages: Record<string, string> = {};
  for (const file of host ? readdirSync(`${FIX}/${dir}`) : []) {
    if (!file.endsWith(".html.gz")) continue;
    const html = gunzipSync(readFileSync(`${FIX}/${dir}/${file}`)).toString("utf8");
    const slug = file.replace(/\.html\.gz$/, "");
    const paths = slug === "index" ? ["", "/"] : slug === "mentions-l-gales" ? ["/mentions-légales", `/${encodeURI("mentions-légales")}`] : [`/${slug}`];
    for (const path of paths) for (const name of [host, `www.${host}`]) pages[`https://${name}${path}`] = html;
  }
  const deps: ContactDeps = {
    async fetchHtml(url) {
      const html = pages[url.replace(/\/$/, "")] ?? pages[url];
      return html ? { html, url } : null;
    },
    async webSearch(query) {
      return meta.searches.find((item) => item.query === query)?.results ?? [];
    },
    async hunterDomainSearch(domain) {
      return hunter.domainSearch?.[domain] ?? [];
    },
    async hunterFinder() {
      return null;
    },
    async hunterVerify(email) {
      return hunter.verify?.[email] ?? "unknown";
    },
  };
  return { company: meta.identity, deps };
}

async function main() {
  console.log("nom en double");
  check("« GLOBAL 2F (GLOBAL 2F) » → « GLOBAL 2F »", singleCompanyName("GLOBAL 2F (GLOBAL 2F)") === "GLOBAL 2F");
  check("casse et espaces ignorés", singleCompanyName("Global 2F  ( GLOBAL 2F )") === "Global 2F");
  check("forme juridique ignorée", singleCompanyName("SARL BONNIN FRERES (BONNIN FRERES)") === "SARL BONNIN FRERES");
  check("un vrai sigle reste", singleCompanyName("SOCIETE NATIONALE DES CHEMINS DE FER (SNCF)") === "SOCIETE NATIONALE DES CHEMINS DE FER (SNCF)");
  check("nom sans parenthèse inchangé", singleCompanyName("BRIOL DIFFUSION") === "BRIOL DIFFUSION");
  check("le générateur reçoit un seul nom", displayCompanyName("GLOBAL 2F (GLOBAL 2F)") === "Global 2F", displayCompanyName("GLOBAL 2F (GLOBAL 2F)"));

  console.log("motifs d'exclusion");
  check("pappers → annuaire d'entreprises", exclusionReason("pappers.fr") === "annuaire d'entreprises");
  check("linkedin → réseau social", exclusionReason("fr.linkedin.com") === "réseau social");
  check("pagesjaunes → annuaire local", exclusionReason("pagesjaunes.fr") === "annuaire local ou carte");
  check("un vrai site → rien", exclusionReason("menuiseriebriol-diffusion.com") === null);

  console.log("GLOBAL 2F (833040736) — pas de site");
  {
    const { company, deps } = replay("global2f", null);
    const { result, trace } = await runContactSearch(company, deps);
    check("aucun site, aucune adresse", !result.website && !result.email, JSON.stringify(result));
    const search = storedSearch(trace, result, company, { contact_search: null }, new Date("2026-09-28T14:00:00Z"));
    const report = searchReport(search)!;
    check("échec → bloc ouvert", report.failed);
    check(
      "conclusion : probablement pas de site",
      report.conclusion === "Aucun site ne mentionne ce SIREN : l'entreprise n'a probablement pas de site.",
      report.conclusion,
    );
    check("requête SIREN citée mot pour mot", report.lines.some((line) => line.includes('« "833040736" mentions légales »')), report.lines.join("\n"));
    check("requête raison sociale citée", report.lines.some((line) => line.includes('« "GLOBAL 2F" mentions légales »')));
    const skipped = report.lines.find((line) => line.startsWith("Écartés sans lecture")) ?? "";
    check("annuaires et réseau social écartés, avec le motif", /pappers\.fr \(annuaire d'entreprises\)/.test(skipped) && /\d+ autre/.test(skipped), skipped);
    check("Hunter : non interrogé, et pourquoi", report.lines.some((line) => line.startsWith("Hunter non interrogé")));
    check("coût : 2 recherches Linkup", report.lines.some((line) => line.startsWith("Coût : 2 recherches Linkup, 0 appel Hunter")), report.lines.at(-1));
    check(`${MAX_REPORT_LINES} lignes au plus, 5 au moins`, report.lines.length >= 5 && report.lines.length <= MAX_REPORT_LINES, String(report.lines.length));
    check("aucune page lue (tout était annuaire)", trace.spent.pages === 0, String(trace.spent.pages));
  }

  console.log("BRIOL DIFFUSION (421882440) — site trouvé");
  {
    const { company, deps } = replay("briol", "menuiseriebriol-diffusion.com", {
      domainSearch: {
        "briol-diffusion.fr": [
          { email: "j.benes@briol-diffusion.fr", type: "personal", firstName: "J", lastName: "Benes", sources: ["https://crouzil.fr/partenaires"] },
        ],
      },
      verify: { "j.benes@briol-diffusion.fr": "valid" },
    });
    const { result, trace } = await runContactSearch(company, deps);
    const search = storedSearch(trace, result, company, { contact_search: null });
    const report = searchReport(search)!;
    check("succès → bloc replié", !report.failed);
    check("conclusion : adresse nominative", report.conclusion.startsWith("Adresse nominative trouvée : j.benes@briol-diffusion.fr"), report.conclusion);
    check("requête SIREN citée", report.lines[0] === 'Recherche web « "421882440" mentions légales » : ' + `${trace.queries![0].results} résultat${trace.queries![0].results > 1 ? "s" : ""}.`, report.lines[0]);
    const read = report.lines.find((line) => line.startsWith("Lu : menuiseriebriol-diffusion.com")) ?? "";
    check("le site lu, ses pages et le verdict", read.includes("/mentions-légales") && read.includes("retenu, SIREN présent sur la page"), read);
    check("ce qui a été cherché est dit", read.includes("Cherché : SIREN, raison sociale, ville, dirigeant, adresses e-mail"), read);
    check("annuaires écartés nommés", report.lines.some((line) => line.startsWith("Écartés sans lecture") && line.includes("annuaire")), report.lines.join("\n"));
    const hunter = report.lines.find((line) => line.startsWith("Hunter :")) ?? "";
    check("appels Hunter et résultats", hunter.includes("domain-search briol-diffusion.fr → 1 adresse(s)") && hunter.includes("email-verifier j.benes@briol-diffusion.fr → valid"), hunter);
    check(`${MAX_REPORT_LINES} lignes au plus`, report.lines.length <= MAX_REPORT_LINES, String(report.lines.length));
    check("cherché : dérivé de l'identité", lookedFor(company).includes("dirigeant"));
    const cost = report.lines.at(-1) ?? "";
    check("Hunter sans prix : le total le dit", cost.includes("hors Hunter (prix non configuré)"), cost);
  }

  console.log("coût, historique, journaux anciens");
  {
    const spent = { linkup: 2, pages: 0, llm: 0, hunterDomainSearch: 1, hunterFinder: 0, hunterVerifier: 1 };
    process.env.HUNTER_SEARCH_EUR = "0.1";
    check("coût = grille de l'écran Coûts", searchCost(spent) === Number((2 * 0.005 * 0.92 + 2 * 0.1).toFixed(4)), String(searchCost(spent)));
    delete process.env.HUNTER_SEARCH_EUR;

    const old: StoredSearch = {
      spent: { linkup: 1, pages: 2, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0 },
      candidates: [{ domain: "exemple.fr", by: "linkup", confidence: 0, validated: false, reason: "aucune mention de l'entreprise" }],
      emailDomains: [],
      steps: ['recherche « "111222333" mentions légales » : 4 résultat(s)', "exemple.fr (linkup) : aucune mention de l'entreprise"],
      result: { confidence: 0, found_by: "aucun" },
      checked_at: "2026-09-27T10:00:00Z",
    };
    const legacy = searchReport(old)!;
    check("journal antérieur : requête relue dans steps", legacy.lines[0] === 'Recherche web « "111222333" mentions légales » : 4 résultats.', legacy.lines[0]);
    check("journal antérieur : conclusion", legacy.conclusion.includes("probablement pas de site"), legacy.conclusion);
    check("journal vide → pas de bloc", searchReport(null) === null && searchReport({} as StoredSearch) === null);

    const next = storedSearch(
      { spent: old.spent!, candidates: [], emailDomains: [], steps: [] },
      { confidence: 0, found_by: "aucun" },
      { legalName: "X", tradeNames: [], siren: null, city: null, postalCode: null, leader: null, prospectId: null, knownWebsite: null, pappersWebsite: null, knownEmail: null },
      { contact_search: old as unknown as Record<string, unknown> },
    );
    check("la recherche précédente passe dans l'historique", next.history?.[0]?.checked_at === "2026-09-27T10:00:00Z" && Boolean(next.history?.[0]?.conclusion));
  }

  console.log("écriture sur la fiche");
  {
    const site = "https://pme-bois.fr";
    const db = new FakeDb({
      prospects: [{ id: "p1", user_id: "u1", company_name: "PME BOIS (PME BOIS)", siren: null, website: null, email: null, city: null, key_figures: {}, signals: [], contact_search: null }],
    });
    const deps: ContactDeps = {
      fetchHtml: async (url) => (url.startsWith(site) ? { html: "<p>PME BOIS</p>", url } : null),
      webSearch: async () => [],
      hunterDomainSearch: async () => [],
      hunterFinder: async () => null,
      hunterVerify: async () => "unknown",
    };
    await findContact("p1", { db: db as never, deps, website: "pme-bois.fr" });
    const saved = db.rows("prospects")[0].contact_search as StoredSearch;
    check("compte rendu daté en base", Boolean(saved.checked_at) && typeof saved.cost_eur === "number" && Array.isArray(saved.looked_for));
    check("pages lues enregistrées", (saved.candidates?.[0]?.pages?.length ?? 0) > 0, JSON.stringify(saved.candidates));
    check("affichable tel quel", searchReport(saved)?.conclusion.startsWith("Site trouvé (pme-bois.fr)") === true, searchReport(saved)?.conclusion);
  }

  if (failures) {
    console.log(`\n${failures} échec(s).`);
    process.exit(1);
  }
  console.log("\nTous les tests du compte rendu passent.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
