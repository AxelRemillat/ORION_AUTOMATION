/**
 * Module contact (lib/contact-finder) — HTML enregistré, aucun réseau.
 *
 * Trois cas réels, résultat attendu EXACT :
 *   - BRIOL DIFFUSION : le site (menuiseriebriol-diffusion.com) et l'adresse
 *     (contact@briol-diffusion.fr) n'ont pas le même domaine ; l'adresse,
 *     publiée sur le site et au nom de l'entreprise, suffit : Hunter n'est
 *     plus appelé (économie Hunter, 01/10/2026).
 *   - SARL BONNIN FRERES : trouvée par son nom commercial, adresse masquée
 *     « contact [at] … » dans les informations légales.
 *   - ARTFLEX : site sans lien avec la raison sociale, retrouvé par le SIREN.
 *
 * Plus les règles dures : jamais d'adresse devinée sans « valid », budget
 * respecté, annuaires écartés.
 *
 * Exécution : `npm run test:contact`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
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

/** Une page enregistrée. Les vraies pages sont gzippées : 1 Mo de HTML Wix. */
const page = (file: string) =>
  file.endsWith(".gz")
    ? gunzipSync(readFileSync(`${FIX}/${file}`)).toString("utf8")
    : readFileSync(`${FIX}/${file}`, "utf8");

/** Nom de fichier d'une page enregistrée (même règle que le script d'enregistrement). */
function fileNameOf(url: string): string {
  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname).replace(/\/$/, "");
  const slug = (path || "/index").replace(/^\//, "").replace(/[^A-Za-z0-9._-]+/g, "-") || "index";
  return `${slug.replace(/\.html?$/, "")}.html.gz`;
}

/**
 * Rejoue un cas enregistré : l'identité réelle, les vrais résultats de recherche,
 * et les pages telles qu'elles ont répondu.
 *
 * Les fixtures viennent de `npx tsx scripts/record-contact-fixtures.ts`. Elles
 * étaient auparavant écrites à la main, et c'est ce qui a laissé passer trois
 * défauts : contenu au-delà de la troncature, URL accentuée, hébergeur pris pour
 * l'entreprise.
 */
function recorded(dir: string) {
  const meta = JSON.parse(readFileSync(`${FIX}/${dir}/search.json`, "utf8")) as {
    identity: CompanyIdentity;
    searches: { query: string; results: { url: string; title: string; snippet: string }[] }[];
  };
  const searches: Record<string, { url: string; title: string; snippet: string }[]> = {};
  for (const item of meta.searches) searches[item.query] = item.results;

  // Toute page enregistrée répond, sous sa forme nue comme en « www. ».
  const pages: Record<string, string> = {};
  for (const file of readdirSync(`${FIX}/${dir}`)) {
    if (!file.endsWith(".html.gz")) continue;
    const html = page(`${dir}/${file}`);
    for (const url of urlsFor(dir, file)) pages[url] = html;
  }
  return { company: meta.identity, searches, pages };
}

/** Les URL sous lesquelles une page enregistrée doit répondre. */
function urlsFor(dir: string, file: string): string[] {
  const host = HOSTS[dir];
  const slug = file.replace(/\.html\.gz$/, "");
  const paths =
    slug === "index"
      ? ["", "/"]
      : slug === "mentions-l-gales"
        ? ["/mentions-légales", `/${encodeURI("mentions-légales")}`]
        : slug === "en-terms-legal-notice"
          ? ["/en/terms/legal-notice"]
          : [`/${slug}`, `/${slug}/`, `/${slug}.html`];
  const hosts = slug === "en-terms-legal-notice" ? ["artflex.software"] : [host];
  return hosts.flatMap((name) => paths.flatMap((path) => [`https://${name}${path}`, `https://www.${name}${path}`]));
}

const HOSTS: Record<string, string> = {
  briol: "menuiseriebriol-diffusion.com",
  bonnin: "boulangerie-bonnin.fr",
  artflex: "robinetterieindustrielle.fr",
};

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
  check(
    "liens légaux suivis d'abord",
    pagesToVisit(page("bonnin/index.html.gz"), "https://boulangerie-bonnin.fr")[0] === "https://boulangerie-bonnin.fr/mentions-legales/",
    pagesToVisit(page("bonnin/index.html.gz"), "https://boulangerie-bonnin.fr")[0],
  );

  console.log("validation");
  const artflex = identity({ legalName: "ARTFLEX", siren: "520644386" });
  check("SIREN en clair → 90", judgePage("édité par ARTFLEX, SIREN 520644386", artflex).confidence === 90);
  check("SIREN espacé → validé", judgePage("RCS 520 644 386", artflex).validated);
  check("nom commercial seul → pas validé", !judgePage("Boulangerie Bonnin Frères", identity({ legalName: "SARL BONNIN FRERES", tradeNames: ["Boulangerie Bonnin Frères"] })).validated);

  console.log("cas 1 — BRIOL DIFFUSION (421882440), réponses réelles");
  {
    const { company, searches, pages } = recorded("briol");
    const { deps, calls } = fakeDeps({
      pages,
      search: searches,
      // Les quatre adresses que Hunter rend vraiment sur briol-diffusion.fr, dont
      // un alias opaque qu'il étiquette « personal ».
      domainSearch: {
        "briol-diffusion.fr": [
          { email: "xbr@briol-diffusion.fr", type: "personal", firstName: null, lastName: null, sources: ["https://mairie-caraman.fr/secteur_d_activite/batiment"] },
          { email: "j.benes@briol-diffusion.fr", type: "personal", firstName: "J", lastName: "Benes", sources: ["https://crouzil.fr/partenaires"] },
        ],
      },
      verify: { "j.benes@briol-diffusion.fr": "valid" },
    });

    const { result, trace } = await runContactSearch(company, deps);
    check("le site est trouvé", result.website === "https://menuiseriebriol-diffusion.com", JSON.stringify(result));
    check(
      "prouvé par le SIREN de la page des mentions légales",
      trace.candidates.some((item) => item.reason === "SIREN présent sur la page"),
      JSON.stringify(trace.candidates),
    );
    // L'URL est accentuée (« /mentions-légales ») : le chemin doit être relu en
    // clair pour être reconnu, sinon la page n'est jamais lue.
    check(
      "la page accentuée est lue",
      calls.pages.some((url) => decodeURIComponent(url).endsWith("/mentions-légales")),
      calls.pages.join(" "),
    );
    check("domaine d'adresse ≠ domaine du site, cherché en premier", trace.emailDomains[0] === "briol-diffusion.fr", trace.emailDomains.join(","));
    check("le dirigeant éponyme est retenu", `${company.leader?.firstName} ${company.leader?.lastName}` === "Xavier Briol", JSON.stringify(company.leader));
    // Économie Hunter (01/10/2026) : le site publie déjà une adresse de confiance
    // (contact@briol-diffusion.fr, domaine au nom de l'entreprise) — Hunter
    // n'est plus appelé pour chercher mieux.
    check("adresse publiée sur le site retenue", result.email === "contact@briol-diffusion.fr" && result.email_type === "generique", JSON.stringify(result));
    check("Hunter non appelé : le site a suffi", calls.domainSearch.length === 0 && calls.finder.length === 0 && calls.verify.length === 0, JSON.stringify(calls));
    check("aucun annuaire lu", !calls.pages.some((url) => /societe\.com|verif\.com|data\.inpi/.test(url)), calls.pages.join(" "));
  }

  console.log("cas 2 — SARL BONNIN FRERES (349925735), réponses réelles");
  {
    const { company, searches, pages } = recorded("bonnin");
    const { deps, calls } = fakeDeps({ pages, search: searches });

    const { result } = await runContactSearch(company, deps);
    check("le site est trouvé", result.website === "https://boulangerie-bonnin.fr", JSON.stringify(result));
    check("adresse publiée retenue", result.email === "contact@boulangerie-bonnin.fr", JSON.stringify(result));
    check("elle vient des mentions légales", (result.email_source_url ?? "").includes("mentions-legales"), result.email_source_url);
    // La requête par métier est celle qui fait sortir le site : ni le SIREN ni la
    // raison sociale ne le rendent (annuaires et homonymes seulement).
    check(
      "le métier entre dans la troisième requête",
      (calls.search[2] ?? "").includes("Boulangerie et boulangerie-pâtisserie"),
      calls.search.join(" | "),
    );
    // L'hébergeur est cité dans les mentions légales : il ne doit jamais devenir
    // un domaine d'adresses, sinon on écrit à un salarié d'OVH.
    check("ovh.com n'est pas interrogé", !calls.domainSearch.includes("ovh.com"), calls.domainSearch.join(","));
    check("nom de famille du dirigeant correct", company.leader?.lastName === "Bonnin", JSON.stringify(company.leader));
  }

  console.log("cas 3 — ARTFLEX (520644386), réponses réelles");
  {
    const { company, searches, pages } = recorded("artflex");
    const { deps, calls } = fakeDeps({ pages, search: searches });

    const { result, trace } = await runContactSearch(company, deps);
    // artflex.software est un éditeur de logiciels homonyme : sa page légale
    // écrit « ARTFLEX », et le nom seul suffisait à le faire retenir.
    check("l'homonyme n'est pas retenu", result.website !== "https://artflex.software", JSON.stringify(result));
    check(
      "il est lu, mais non validé",
      trace.candidates.some((item) => item.domain === "artflex.software" && !item.validated),
      JSON.stringify(trace.candidates),
    );
    check("le vrai site est trouvé", result.website === "https://robinetterieindustrielle.fr", JSON.stringify(result));
    check(
      "prouvé par le SIREN",
      trace.candidates.some((item) => item.domain === "robinetterieindustrielle.fr" && item.reason === "SIREN présent sur la page"),
      JSON.stringify(trace.candidates),
    );
    // Le site PUBLIE une adresse, masquée par Joomla (variables « addy… ») :
    // l'ancien test figeait le bug (« aucune adresse »). Son domaine porte le
    // nom de l'entreprise : il est de confiance.
    check(
      "adresse masquée par Joomla retrouvée sur le site",
      result.email === "info@artflex-robinetterie.fr" && result.email_type === "generique" && !result.doubtful,
      JSON.stringify(result),
    );
    check("téléphone du site relevé", result.phone === "04 72 71 20 80", String(result.phone));
    // L'adresse Joomla suffit : plus aucun crédit Hunter dépensé ici.
    check("Hunter non appelé : l'adresse masquée du site suffit", calls.domainSearch.length === 0, calls.domainSearch.join(","));
  }

  console.log("règles");
  {
    const site = "https://pme-bois.fr";
    const legal = `<a href="/mentions-legales">Mentions légales</a>`;
    const company = identity({
      legalName: "PME BOIS", siren: "111222333", knownWebsite: site, leader: { firstName: "Paul", lastName: "Durand" },
    });
    const setup = {
      pages: { [site]: `<h1>PME BOIS</h1>${legal}`, [`${site}/mentions-legales`]: "PME BOIS SIREN 111222333 contact@pme-bois.fr" },
      finder: { "Paul Durand@pme-bois.fr": "paul.durand@pme-bois.fr" },
      verify: { "paul.durand@pme-bois.fr": "valid" as VerifierStatus },
    };
    // Économie Hunter (01/10/2026) : le gratuit d'abord — une adresse de
    // confiance sur le site, et Hunter n'est pas appelé du tout.
    const free = fakeDeps(setup);
    const { result } = await runContactSearch(company, free.deps);
    check("adresse du site gardée, Hunter non appelé", result.email === "contact@pme-bois.fr" && free.calls.finder.length === 0 && free.calls.domainSearch.length === 0, JSON.stringify(free.calls));
    check("found_by explicite", result.found_by === "site:mentions-legales", result.found_by);
    // La générique du site n'est JAMAIS soumise à l'email-verifier.
    check("pas d'email-verifier sur la générique du site", !free.calls.verify.includes("contact@pme-bois.fr"), free.calls.verify.join(","));

    // Rien sur le site : Hunter reprend la main (email-finder + verifier).
    const sansAdresse = { [site]: `<h1>PME BOIS</h1>${legal}`, [`${site}/mentions-legales`]: "PME BOIS SIREN 111222333" };
    const empty = fakeDeps({ ...setup, pages: sansAdresse });
    const viaHunter = await runContactSearch(company, empty.deps);
    check("rien sur le site → Hunter : nominatif « valid »", viaHunter.result.email === "paul.durand@pme-bois.fr" && viaHunter.result.found_by === "hunter:email-finder+verifier:valid", JSON.stringify(viaHunter.result));

    // Rien sur le site, mais Hunter refusé (crédits, score, fiche à écarter) :
    // aucun appel, motif rendu pour « à compléter (Hunter épuisé) ».
    const blocked = fakeDeps({ ...setup, pages: sansAdresse });
    const refused = await runContactSearch(company, blocked.deps, undefined, { hunter: { allowed: false, reason: "Hunter épuisé : budget du jour atteint (10/10)" } });
    check("Hunter refusé : aucun appel", blocked.calls.finder.length + blocked.calls.domainSearch.length + blocked.calls.verify.length === 0, JSON.stringify(blocked.calls));
    check("… et le motif est rendu", !refused.result.email && refused.result.hunter_skipped === "Hunter épuisé : budget du jour atteint (10/10)", JSON.stringify(refused.result));
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
    // 14 lectures : elles ne coûtent aucun crédit, et 8 ne suffisaient pas à
    // atteindre le vrai site quand les premiers candidats étaient morts.
    check("budget : 14 pages au plus", calls.pages.length <= 14, String(calls.pages.length));
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

  console.log("cas — domaine de confiance, Joomla, téléphone (30/09/2026)");
  {
    // HÖRMANN FRANCE : une adresse d'un domaine sans rapport (louis@louis.info)
    // vue sur le site sortait « contactable ».
    const identity: CompanyIdentity = {
      prospectId: null, legalName: "PORTES MARTIN", tradeNames: [], siren: "123456789", city: "Lyon", postalCode: "69003",
      leader: null, activity: null, knownWebsite: "https://portes-martin.fr", pappersWebsite: null, knownEmail: null,
    };
    const home = `<html><body><h1>Portes Martin</h1><p>Portes Martin, SIREN 123 456 789, Lyon.</p>
      <p>Site réalisé par Louis — louis@louis.info</p><a href="tel:+33478123456">Appelez-nous</a>
      <a href="/contact">Contact</a></body></html>`;
    const pages = { "https://portes-martin.fr": home };
    const outsider = fakeDeps({
      pages,
      domainSearch: { "louis.info": [{ email: "louis@louis.info", type: "personal", firstName: "Louis", lastName: null, sources: [] }] },
      verify: { "louis@louis.info": "accept_all" },
    });
    const kept = await runContactSearch(identity, outsider.deps);
    check("adresse hors domaine, non « valid » : écartée", !kept.result.email, JSON.stringify(kept.result));
    check("le téléphone du site est gardé (« à appeler »)", kept.result.phone === "04 78 12 34 56", String(kept.result.phone));

    const validOutsider = fakeDeps({
      pages,
      domainSearch: { "louis.info": [{ email: "louis@louis.info", type: "personal", firstName: "Louis", lastName: null, sources: [] }] },
      verify: { "louis@louis.info": "valid" },
    });
    const doubtful = await runContactSearch(identity, validOutsider.deps);
    check("hors domaine mais Hunter « valid » : gardée, marquée douteuse", doubtful.result.email === "louis@louis.info" && doubtful.result.doubtful === true, JSON.stringify(doubtful.result));

    // Joomla : l'adresse n'est jamais écrite en clair dans la page.
    const cloaked = `<span id="cloak4f1">Cette adresse est protégée</span><script type="text/javascript">
      document.getElementById('cloak4f1').innerHTML = '';
      var prefix = '&#109;a' + 'i&#108;' + '&#116;o';
      var addy4f1 = 'c&#111;nt&#97;ct' + '&#64;';
      addy4f1 = addy4f1 + 'p&#111;rtes-m&#97;rtin' + '&#46;' + 'fr';
      document.getElementById('cloak4f1').innerHTML += '<a ' + path + '\\'' + prefix + ':' + addy4f1 + '\\'>'+addy4f1+'<\\/a>';
      </script>`;
    check("adresse masquée par Joomla retrouvée", extractEmails(cloaked).includes("contact@portes-martin.fr"), extractEmails(cloaked).join(","));
    const joomla = fakeDeps({ pages: { "https://portes-martin.fr": home.replace("louis@louis.info", "") + cloaked } });
    const found = await runContactSearch(identity, joomla.deps);
    check("… et retenue sur le domaine du site", found.result.email === "contact@portes-martin.fr" && !found.result.doubtful, JSON.stringify(found.result));
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
