/**
 * Module contact (lib/contact-finder) — HTML enregistré, aucun réseau.
 *
 * Trois cas réels, résultat attendu EXACT :
 *   - BRIOL DIFFUSION : le site (menuiseriebriol-diffusion.com) et l'adresse
 *     (contact@briol-diffusion.fr) n'ont pas le même domaine ; Hunter doit
 *     chercher sur le domaine de l'ADRESSE, avec le nom d'usage « Briol ».
 *   - SARL BONNIN FRERES : trouvée par son nom commercial, adresse masquée
 *     « contact [at] … » dans les informations légales.
 *   - ARTFLEX : site sans lien avec la raison sociale, retrouvé par le SIREN.
 *
 * Plus les règles dures : jamais d'adresse devinée sans « valid », budget
 * respecté, annuaires écartés.
 *
 * Exécution : `npm run test:contact`.
 */
import { readFileSync } from "node:fs";
import { runContactSearch, type ContactDeps, type HunterHit, type VerifierStatus } from "../lib/contact-finder/finder";
import { usageName } from "../lib/contact-finder/names";
import { classifyEmail, deobfuscate, extractEmails } from "../lib/contact-finder/extract";
import { isExcludedDomain } from "../lib/contact-finder/domains";
import { pagesToVisit } from "../lib/contact-finder/links";
import { judgePage } from "../lib/contact-finder/validate";
import type { CompanyIdentity, ContactResult } from "../lib/contact-finder/types";
import { findContact } from "../lib/contact-finder";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const same = (actual: unknown, expected: unknown) => JSON.stringify(actual) === JSON.stringify(expected);

const FIX = "scripts/fixtures/contact-finder";
const page = (file: string) => readFileSync(`${FIX}/${file}`, "utf8");

/** Faux réseau : des pages par URL, des résultats de recherche, des réponses Hunter. */
function fakeDeps(setup: {
  pages: Record<string, string>;
  search?: Record<string, { url: string; title: string; snippet: string }[]>;
  domainSearch?: Record<string, HunterHit[]>;
  finder?: Record<string, string>;
  verify?: Record<string, VerifierStatus>;
}) {
  const calls = { pages: [] as string[], search: [] as string[], domainSearch: [] as string[], finder: [] as string[], verify: [] as string[] };
  const deps: ContactDeps = {
    async fetchHtml(url) {
      calls.pages.push(url);
      const key = url.replace(/\/$/, "");
      const html = setup.pages[key] ?? setup.pages[url];
      return html ? { html, url } : null;
    },
    async webSearch(query) {
      calls.search.push(query);
      return setup.search?.[query] ?? [];
    },
    async hunterDomainSearch(domain) {
      calls.domainSearch.push(domain);
      return setup.domainSearch?.[domain] ?? [];
    },
    async hunterFinder(domain, first, last) {
      calls.finder.push(`${first} ${last}@${domain}`);
      const email = setup.finder?.[`${first} ${last}@${domain}`];
      return email ? { email } : null;
    },
    async hunterVerify(email) {
      calls.verify.push(email);
      return setup.verify?.[email] ?? "unknown";
    },
  };
  return { deps, calls };
}

const identity = (over: Partial<CompanyIdentity>): CompanyIdentity => ({
  prospectId: null, legalName: "", tradeNames: [], siren: null, city: null, postalCode: null,
  leader: null, knownWebsite: null, pappersWebsite: null, knownEmail: null, ...over,
});

async function main() {
  console.log("nom d'usage");
  check("« BRIOL Séverine née NASSIF » → Séverine Briol", same(usageName("BRIOL Séverine née NASSIF"), { firstName: "Séverine", lastName: "Briol" }));
  check("« Séverine NASSIF épouse BRIOL » → Séverine Briol", same(usageName("Séverine NASSIF épouse BRIOL"), { firstName: "Séverine", lastName: "Briol" }));
  check("« Jean-Pierre MARTIN » → Jean-Pierre Martin", same(usageName("Jean-Pierre MARTIN"), { firstName: "Jean-Pierre", lastName: "Martin" }));
  check("un seul mot → rien", usageName("MARTIN") === null);
  check(
    "casse normalisée par Pappers + prénom connu → Séverine Briol",
    same(usageName("Briol Séverine Née Nassif", { firstName: "Séverine" }), { firstName: "Séverine", lastName: "Briol" }),
  );

  console.log("extraction");
  check("« contact [at] exemple.fr »", same(extractEmails("écrire à contact [at] exemple-pme.fr svp"), ["contact@exemple-pme.fr"]));
  check("« jean(at)pme(dot)fr »", same(extractEmails("jean(at)pme-bois(dot)fr"), ["jean@pme-bois.fr"]));
  check("entité &#64;", deobfuscate("a&#64;b.fr") === "a@b.fr");
  check("image@2x.png ignorée", extractEmails("logo@2x.png").length === 0);
  check("contact@ est générique", classifyEmail("contact@briol-diffusion.fr") === "generique");
  check("s.briol@ est nominatif pour Séverine Briol", classifyEmail("s.briol@x.fr", { firstName: "Séverine", lastName: "Briol" }) === "nominatif");

  console.log("domaines");
  check("pagesjaunes écarté", isExcludedDomain("pagesjaunes.fr"));
  check("societe.com écarté", isExcludedDomain("www.societe.com"));
  check("annuaire sectoriel écarté", isExcludedDomain("annuaire-boulangeries.fr"));
  check("dunkerque-menuiserie.fr gardé (pas de faux positif « dun »)", !isExcludedDomain("dunkerque-menuiserie.fr"));
  check("boulangerie-bonnin.fr gardé", !isExcludedDomain("boulangerie-bonnin.fr"));
  check("liens légaux suivis d'abord", pagesToVisit(page("bonnin/home.html"), "https://boulangerie-bonnin.fr")[0] === "https://boulangerie-bonnin.fr/infos-legales");

  console.log("validation");
  const artflex = identity({ legalName: "ARTFLEX", siren: "520644386" });
  check("SIREN en clair → 90", judgePage("édité par ARTFLEX, SIREN 520644386", artflex).confidence === 90);
  check("SIREN espacé → validé", judgePage("RCS 520 644 386", artflex).validated);
  check("nom commercial seul → pas validé", !judgePage("Boulangerie Bonnin Frères", identity({ legalName: "SARL BONNIN FRERES", tradeNames: ["Boulangerie Bonnin Frères"] })).validated);

  console.log("cas 1 — BRIOL DIFFUSION (421882440)");
  {
    const site = "https://menuiseriebriol-diffusion.com";
    const { deps, calls } = fakeDeps({
      pages: { [site]: page("briol/home.html"), [`${site}/mentions-legales`]: page("briol/mentions-legales.html"), [`${site}/contact`]: page("briol/contact.html") },
      search: { '"BRIOL DIFFUSION" mentions légales': [
        { url: "https://www.societe.com/societe/briol-diffusion-421882440.html", title: "BRIOL DIFFUSION", snippet: "SIREN 421 882 440" },
        { url: `${site}/mentions-legales`, title: "Mentions légales", snippet: "BRIOL DIFFUSION" },
      ] },
      // Hunter devine s.briol@ mais ne peut que répondre accept_all : REFUSÉ.
      finder: { "Séverine Briol@briol-diffusion.fr": "s.briol@briol-diffusion.fr" },
      verify: { "s.briol@briol-diffusion.fr": "accept_all" },
    });
    const { result, trace } = await runContactSearch(identity({
      legalName: "BRIOL DIFFUSION", siren: "421882440", leader: usageName("BRIOL Séverine née NASSIF"),
    }), deps);
    const expected: ContactResult = {
      website: site, email: "contact@briol-diffusion.fr", email_type: "generique",
      email_source_url: `${site}/mentions-legales`, confidence: 85, found_by: "site:mentions-legales",
    };
    check("résultat exact", same(result, expected), JSON.stringify(result));
    check("domaine d'adresse ≠ domaine du site, cherché en premier", trace.emailDomains[0] === "briol-diffusion.fr", trace.emailDomains.join(","));
    check("Hunter domain-search sur le domaine de l'ADRESSE", calls.domainSearch[0] === "briol-diffusion.fr");
    check("email-finder avec le NOM D'USAGE", same(calls.finder, ["Séverine Briol@briol-diffusion.fr"]));
    check("adresse devinée + accept_all → refusée", result.email !== "s.briol@briol-diffusion.fr");
    check("societe.com jamais lu", !calls.pages.some((url) => url.includes("societe.com")));
  }

  console.log("cas 2 — SARL BONNIN FRERES (Angles 85)");
  {
    const site = "https://boulangerie-bonnin.fr";
    const { deps, calls } = fakeDeps({
      pages: { [site]: page("bonnin/home.html"), [`${site}/infos-legales`]: page("bonnin/infos-legales.html") },
      search: { '"Boulangerie Bonnin Frères" Angles': [
        { url: "https://www.pagesjaunes.fr/pros/boulangerie-bonnin", title: "Boulangerie Bonnin", snippet: "Angles" },
        { url: `${site}/`, title: "Boulangerie Bonnin Frères", snippet: "Pains au levain à Angles" },
      ] },
    });
    const { result } = await runContactSearch(identity({
      legalName: "SARL BONNIN FRERES", tradeNames: ["Boulangerie Bonnin Frères"], city: "Angles", postalCode: "85750",
    }), deps);
    const expected: ContactResult = {
      website: site, email: "contact@boulangerie-bonnin.fr", email_type: "generique",
      email_source_url: `${site}/infos-legales`, confidence: 75, found_by: "site:mentions-legales",
    };
    check("résultat exact", same(result, expected), JSON.stringify(result));
    check("recherche par nom commercial en premier", calls.search[0] === '"Boulangerie Bonnin Frères" Angles');
    check("une seule recherche web suffit", calls.search.length === 1);
    check("pagesjaunes jamais lu", !calls.pages.some((url) => url.includes("pagesjaunes")));
  }

  console.log("cas 3 — ARTFLEX (520644386)");
  {
    const site = "https://robinetterieindustrielle.fr";
    const { deps, calls } = fakeDeps({
      pages: { [site]: page("artflex/home.html"), [`${site}/mentions-legales`]: page("artflex/mentions-legales.html"), [`${site}/contact`]: page("artflex/contact.html") },
      search: { '"520644386" mentions légales': [{ url: `${site}/mentions-legales/`, title: "Mentions légales", snippet: "ARTFLEX 520644386" }] },
    });
    const { result } = await runContactSearch(identity({ legalName: "ARTFLEX", siren: "520644386" }), deps);
    const expected: ContactResult = { website: site, confidence: 45, found_by: `site:linkup:"520644386" mentions légales` };
    check("résultat exact (site trouvé, aucune adresse publiée)", same(result, expected), JSON.stringify(result));
    check("retrouvé par le SIREN après la raison sociale", same(calls.search, ['"ARTFLEX" mentions légales', '"520644386" mentions légales']));
    check("Hunter interrogé sur le site trouvé", same(calls.domainSearch, ["robinetterieindustrielle.fr"]));
  }

  console.log("règles");
  {
    const site = "https://pme-bois.fr";
    const legal = `<a href="/mentions-legales">Mentions légales</a>`;
    const { deps } = fakeDeps({
      pages: { [site]: `<h1>PME BOIS</h1>${legal}`, [`${site}/mentions-legales`]: "PME BOIS SIREN 111222333 contact@pme-bois.fr" },
      finder: { "Paul Durand@pme-bois.fr": "paul.durand@pme-bois.fr" },
      verify: { "paul.durand@pme-bois.fr": "valid" },
    });
    const { result } = await runContactSearch(identity({
      legalName: "PME BOIS", siren: "111222333", knownWebsite: site, leader: { firstName: "Paul", lastName: "Durand" },
    }), deps);
    check("nominatif vérifié « valid » > générique du site", result.email === "paul.durand@pme-bois.fr" && result.email_type === "nominatif");
    check("found_by explicite", result.found_by === "hunter:email-finder+verifier:valid", result.found_by);
  }
  {
    const pages: Record<string, string> = {};
    const search: Record<string, { url: string; title: string; snippet: string }[]> = {};
    const company = identity({ legalName: "INTROUVABLE", siren: "999888777", tradeNames: ["Chez Nous"], city: "Nulle-Part" });
    for (const query of ['"Chez Nous" Nulle-Part', '"INTROUVABLE" mentions légales', '"999888777" mentions légales']) {
      search[query] = [1, 2, 3].map((n) => ({ url: `https://site${n}-${query.length}.fr`, title: "x", snippet: "x" }));
    }
    for (let n = 1; n <= 3; n += 1) for (const len of [24, 33, 31]) pages[`https://site${n}-${len}.fr`] = "<p>rien</p>";
    const { deps, calls } = fakeDeps({ pages, search });
    const { result, trace } = await runContactSearch(company, deps);
    check("budget : 3 recherches au plus", calls.search.length <= 3, String(calls.search.length));
    check("budget : 8 pages au plus", calls.pages.length <= 8, String(calls.pages.length));
    check("rien de prouvé → aucune adresse, aucun Hunter", !result.email && calls.domainSearch.length === 0);
    check("dépenses tracées", trace.spent.pages === calls.pages.length && trace.spent.linkup === calls.search.length);
  }

  {
    const www = "https://www.seulement-www.fr";
    const { deps } = fakeDeps({ pages: { [www]: `<a href="/mentions-legales">ML</a>`, [`${www}/mentions-legales`]: "SEULEMENT WWW SIREN 123456789 contact@seulement-www.fr" } });
    const { result } = await runContactSearch(identity({ legalName: "SEULEMENT WWW", siren: "123456789", knownWebsite: "seulement-www.fr" }), deps);
    check("repli sur www. quand le domaine nu ne répond pas", result.email === "contact@seulement-www.fr", JSON.stringify(result));
  }

  console.log("écriture sur la fiche");
  {
    const site = "https://pme-bois.fr";
    const pages = { [site]: `<a href="/mentions-legales">Mentions légales</a>`, [`${site}/mentions-legales`]: "PME BOIS contact@pme-bois.fr" };
    const row = (over: Record<string, unknown>) => ({
      id: "p1", user_id: "u1", company_name: "PME BOIS", siren: null, website: null, email: null, city: null,
      key_figures: {}, signals: [], contact_found_by: null, email_type: null, contact_confidence: null, ...over,
    });

    const empty = new FakeDb({ prospects: [row({})] });
    const found = await findContact("p1", { db: empty as never, deps: fakeDeps({ pages }).deps, website: "pme-bois.fr" });
    const saved = empty.rows("prospects")[0];
    check("site saisi à la main : écrit et utilisé", saved.website === site && found.website === site);
    check("adresse écrite avec sa provenance", saved.email === "contact@pme-bois.fr" && saved.email_type === "generique" && saved.email_source_url === `${site}/mentions-legales`);
    check("journal de recherche enregistré", Boolean(saved.contact_search) && Boolean(saved.contact_checked_at));

    const manual = new FakeDb({ prospects: [row({ website: site, email: "paul@pme-bois.fr" })] });
    await findContact("p1", { db: manual as never, deps: fakeDeps({ pages }).deps });
    check("adresse saisie à la main jamais écrasée", manual.rows("prospects")[0].email === "paul@pme-bois.fr");

    const dry = new FakeDb({ prospects: [row({ website: site })] });
    await findContact("p1", { db: dry as never, deps: fakeDeps({ pages }).deps, persist: false });
    check("persist: false n'écrit rien", dry.rows("prospects")[0].email === null);
  }

  if (failures) {
    console.log(`\n${failures} échec(s).`);
    process.exit(1);
  }
  console.log("\nTous les tests contact passent.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
