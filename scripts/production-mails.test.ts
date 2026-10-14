/**
 * Production de mails (Cowork #27) : entonnoir chiffré et réserve Linkup des recherches de
 * site. Aucun réseau, aucun crédit réel.
 */
import { buildProductionFunnel, costFamily, type FunnelSignal } from "../lib/funnel/production-funnel";
import { linkupGate, linkupSiteReserve, type LinkupGateStore } from "../lib/linkup/gate";
import { matchHomepage, recoveryDomains, robotsForbidsHome } from "../lib/funnel/free-site-recovery";
import { decodeCfEmails } from "../lib/contact-finder/cloudflare";
import { extractEmails } from "../lib/contact-finder/extract";
import { exclusionReason, isServiceProvider } from "../lib/contact-finder/domains";
import { runContactSearch, type ContactDeps } from "../lib/contact-finder/finder";
import { contactDomainMismatch } from "../lib/today/contact-domain";
import { ownerMismatch } from "../lib/contact-finder/owner";
import { buildQualityGreeting } from "../lib/emails/quality/greeting";
import { wwwVariant } from "../lib/enrichment/www";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const at = "2026-10-13T08:00:00Z";
const signal = (patch: Partial<FunnelSignal>): FunnelSignal => ({ created_at: at, source: "france-travail", statut: "rejeté", motif_rejet: null, identity: { siren: "1" }, publication: null, contact: null, prospect_id: null, ...patch });

console.log("Entonnoir de production");
const report = buildProductionFunnel({
  since: "2026-10-12",
  until: "2026-10-13",
  signals: [
    signal({ statut: "brut", identity: null }),
    signal({ motif_rejet: "non examiné (plafond du run)", identity: null }),
    signal({ identity: null, motif_rejet: "Entreprise introuvable à l'annuaire" }),
    signal({ motif_rejet: "Opposition à la prospection (registre)" }),
    signal({ motif_rejet: "Agence d'emploi : signal pour un client" }),
    signal({ motif_rejet: "score 3/5 sous le seuil" }),
    signal({ statut: "retenu" }),
    signal({ statut: "creusé", publication: "pret", contact: { badge: "nominatif" }, prospect_id: "p1" }),
    signal({ statut: "creusé", publication: "pret", contact: { badge: "générique" }, prospect_id: "p2" }),
  ],
  prospects: [
    { id: "p1", created_at: at, business_profile: { metier: "x" }, key_figures: null, website: "a.fr", email: "a@a.fr" },
    { id: "p2", created_at: at, business_profile: { metier: "y" }, key_figures: null, website: "b.fr", email: "b@b.fr" },
    { id: "p3", created_at: at, business_profile: { metier: "z" }, key_figures: { mail_review: { reason: "Faits insuffisants : aucun" } }, website: null, email: null },
  ],
  drafts: [
    { prospect_id: "p1", created_at: at, quality_score: 9, quality_reason: null },
    { prospect_id: "p2", created_at: at, quality_score: 7, quality_reason: "À revoir" },
    { prospect_id: "p1", created_at: at, quality_score: 10, quality_reason: null, origin: "relance" },
  ],
  usage: [
    { created_at: at, service: "openai", operation: "qualite:redaction", units: 1000, cost: 0.2 },
    { created_at: at, service: "hunter", operation: "contact:domain", units: 1, cost: 0.02 },
  ],
});
check("jours ouvrés seulement (lundi, mardi)", report.days.join(",") === "2026-10-12,2026-10-13", report.days.join(","));
check("9 collectés, 7 examinés, 6 au registre", report.totals["collectés"] === 9 && report.totals["examinés"] === 7 && report.totals["trouvés au registre"] === 6, JSON.stringify(report.totals));
check("opposé et hors cible comptés à part", report.extra.opposed === 1 && report.extra.offTarget === 1 && report.totals["non opposés"] === 5);
check("retenus = retenu + creusé", report.totals["retenus (tri)"] === 3);
check("e-mail : 1 nominatif, 1 générique", report.totals["e-mail trouvé"] === 2 && report.extra.nominative === 1 && report.extra.generic === 1);
check("faits insuffisants bloquent la rédaction", report.extra.factsBlocked === 1 && report.totals["faits suffisants"] === 2);
check("la relance ne compte pas comme brouillon d'intro", report.totals["brouillon rédigé"] === 2);
check("prêt = ≥ 9/10 sans motif ; le reste « à revoir »", report.totals["prêt (≥ 9/10)"] === 1 && report.extra.aRevoir === 1);
check("par jour : mardi porte tout", report.byDay["2026-10-13"]["prêt (≥ 9/10)"] === 1 && report.byDay["2026-10-12"]["collectés"] === 0);
check("coût par famille", report.cost[0].family === "OpenAI · rédaction" && Math.abs(report.cost[0].eur - 0.2) < 1e-9);
check("familles de coût", costFamily("linkup", "linkup_site").startsWith("Linkup") && costFamily("openai", "entonnoir:tri") === "OpenAI · tri des signaux" && costFamily("openai", "qualite:checklist") === "OpenAI · juge");

console.log("Rattrapage gratuit des « Sans site »");
const ovinalp = { names: ["OVINALP FERTILISATION"], siren: "123456789", city: "Saint-Jean-de-Maurienne", postalCode: "73300" };
const domains = recoveryDomains(ovinalp);
check("candidats : nom entier collé et tiré", domains.includes("ovinalpfertilisation.fr") && domains.includes("ovinalp-fertilisation.com"), domains.join(","));
check("candidats : 16 au plus, aucun annuaire", domains.length <= 16 && !domains.some((domain) => /pagesjaunes|societe\.com/.test(domain)));
check("sigle pour 3 mots et plus", recoveryDomains({ names: ["ATELIER MECANIQUE GENERALE"], siren: null, city: null, postalCode: null }).includes("amg.fr"));
check("sûr : nom + SIREN (espacé)", JSON.stringify(matchHomepage("<h1>Ovinalp Fertilisation</h1><footer>SIREN 123 456 789</footer>", ovinalp)) === JSON.stringify({ sure: true, by: "siren" }));
check("sûr : nom + ville", matchHomepage("<p>OVINALP - Fertilisation</p><p>73300 Saint-Jean-de-Maurienne</p>", ovinalp).sure);
check("refusé : nom seul", !matchHomepage("<title>Ovinalp Fertilisation</title>", ovinalp).sure);
check("refusé : ville seule (homonyme de domaine)", !matchHomepage("<p>Saint-Jean-de-Maurienne 73300</p>", ovinalp).sure);
check("le texte des scripts ne compte pas", !matchHomepage("<script>var a='Ovinalp Fertilisation 73300'</script>", ovinalp).sure);
check("robots : Disallow / pour * = interdit", robotsForbidsHome("User-agent: *\nDisallow: /"));
check("robots : Disallow /admin = permis", !robotsForbidsHome("User-agent: *\nDisallow: /admin"));
check("robots : interdit à un autre robot seulement = permis", !robotsForbidsHome("User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:"));

console.log("Adresses protégées par Cloudflare");
const cf = (email: string, key = 0x5a) => key.toString(16).padStart(2, "0") + [...email].map((char) => (char.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
check("data-cfemail décodé", decodeCfEmails(`<a data-cfemail="${cf("contact@barthouil.fr")}">[email protected]</a>`).join() === "contact@barthouil.fr");
check("lien /cdn-cgi/l/email-protection décodé", decodeCfEmails(`<a href="/cdn-cgi/l/email-protection#${cf("info@sbflorac.com", 0x13)}">`).join() === "info@sbflorac.com");
check("hexadécimal sans adresse ignoré", decodeCfEmails('<a data-cfemail="abcdef0123">').length === 0);

console.log("Étape e-mail (Cowork #34)");
check("extractEmails lit une adresse Cloudflare", extractEmails(`<a href="/cdn-cgi/l/email-protection#${cf("contact@barthouil.fr")}">x</a>`).includes("contact@barthouil.fr"));
check("adresse de l'agence web écartée (Linkeo)", isServiceProvider("linkeo.com") && extractEmails("service@linkeo.com · contact@loiseaubleu.re").join() === "contact@loiseaubleu.re");
check("portail de marque refusé (spoticar.fr)", exclusionReason("spoticar.fr") === "portail de marque ou de réseau");
check("garage indépendant au nom de marque accepté", exclusionReason("renault-garage-dupont.fr") === null);
check("sous-domaine applicatif refusé, domaine nu accepté", exclusionReason("workspace.outsourcia.fr") === "sous-domaine applicatif" && exclusionReason("outsourcia.fr") === null);
check("adresse hors domaine = « à vérifier » dans Aujourd'hui", contactDomainMismatch("contact@sbflorac.com", "https://maconnerie-renovation-florac.fr") !== null);

console.log("Contact ≠ titulaire de l'adresse (Cowork #35)");
check("RISO : f.taoufik@ ≠ Toshihiko Kawatsu", ownerMismatch("f.taoufik@risofrance.fr", "Toshihiko Kawatsu") === true);
check("tduguit@ = Timothee Duguit", ownerMismatch("tduguit@duguit.com", "Timothee Duguit") === false);
check("xu.an@ = Xu An (mot court = segment)", ownerMismatch("xu.an@telma.com", "Xu An") === false);
check("boîte de rôle : rien à vérifier", ownerMismatch("contact@arcomprovence.com", "Robert Abbes") === null);
const greet = (email: string, contactName: string | null, leaderPerson: string | null, contactIsRecipient = true) => buildQualityGreeting({ email, contactName, leaderPerson, contactIsRecipient });
check("RISO : « Bonjour, », jamais M. Kawatsu", greet("f.taoufik@risofrance.fr", "Toshihiko Kawatsu", "Toshihiko Kawatsu") === "Bonjour,");
check("SKI SHOP : benjamin.d@ ne salue pas le dirigeant", greet("benjamin.d@skishop.fr", "Nicolas Jacquier", "Nicolas Jacquier") === "Bonjour,");
check("titulaire nommé : salué", greet("paul.marolleau@sud-ouest-radiateurs.com", "Paul Marolleau", null) === "Bonjour Monsieur Marolleau,");
check("boîte de rôle : « Bonjour, » (règle #59)", greet("contact@arcomprovence.com", "Robert Abbes", "Robert Abbes", false) === "Bonjour,");

console.log("Domaine nu muet → www. (Cowork #35)");
check("https://planfor.fr → www.planfor.fr", wwwVariant("https://planfor.fr") === "https://www.planfor.fr");
check("le chemin est gardé", wwwVariant("https://gravir.fr/contact") === "https://www.gravir.fr/contact");
check("déjà « www. » ou sous-domaine : rien", wwwVariant("https://www.planfor.fr") === null && wwwVariant("https://shop.exemple.fr") === null);
check("suffixe à deux niveaux", wwwVariant("https://exemple.co.uk") === "https://www.exemple.co.uk");

async function finder() {
  const page = `<html><body><h1>S ET B Maçonnerie</h1><p>SARL DOS SANTOS - BARROSO, SIREN 123 456 789, 48400 Florac</p><a href="/contact">Contact</a><a href="/cdn-cgi/l/email-protection#${cf("contact@sbflorac.com")}">écrire</a><a href="https://linkeo.com">service@linkeo.com</a></body></html>`;
  const deps: ContactDeps = { fetchHtml: async (url) => ({ html: page, url }), webSearch: async () => null, hunterDomainSearch: async () => null, hunterFinder: async () => null, hunterVerify: async () => null };
  const company = { prospectId: null, legalName: "SARL DOS SANTOS - BARROSO (S ET B)", tradeNames: [], siren: "123456789", city: "Florac", postalCode: "48400", leader: null, activity: null, knownWebsite: "https://maconnerie-renovation-florac.fr", pappersWebsite: null, knownEmail: null };
  const { result } = await runContactSearch(company, deps, { linkup: 0, pages: 4, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0 }, { hunter: { allowed: false } });
  check("site prouvé + adresse hors domaine : gardée, marquée douteuse", result.email === "contact@sbflorac.com" && result.doubtful === true, JSON.stringify(result));
  const unproven = await runContactSearch({ ...company, siren: null, city: null, postalCode: null, legalName: "AUTRE NOM" }, deps, { linkup: 0, pages: 4, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0 }, { hunter: { allowed: false } });
  check("site NON prouvé : l'adresse hors domaine reste écartée", unproven.result.email !== "contact@sbflorac.com", JSON.stringify(unproven.result));
}

async function linkup() {
  console.log("Réserve Linkup des recherches de site");
  const store = (used: number): LinkupGateStore => ({ read: async () => null, write: async () => undefined, usedSince: async () => used });
  const now = new Date("2026-10-13T10:00:00Z");
  const previous = { budget: process.env.LINKUP_DAILY_BUDGET, reserve: process.env.LINKUP_SITE_RESERVE };
  process.env.LINKUP_DAILY_BUDGET = "30";
  delete process.env.LINKUP_SITE_RESERVE;
  check("réserve par défaut : 15", linkupSiteReserve() === 15);
  check("enrichissement permis sous 15", (await linkupGate(store(14), "q", now, "search", "enrich")).status === "call");
  const blocked = await linkupGate(store(15), "q", now, "search", "enrich");
  check("enrichissement bloqué à 15/30", blocked.status === "blocked" && /recherche de site/.test(blocked.status === "blocked" ? blocked.reason : ""));
  check("recherche de site permise à 15/30", (await linkupGate(store(15), "q", now, "search", "site")).status === "call");
  check("recherche de site permise à 29/30", (await linkupGate(store(29), "q", now)).status === "call");
  check("tout bloqué à 30/30", (await linkupGate(store(30), "q", now)).status === "blocked");
  process.env.LINKUP_SITE_RESERVE = "0";
  check("réserve 0 : enrichissement jusqu'au plafond", (await linkupGate(store(29), "q", now, "search", "enrich")).status === "call");
  process.env.LINKUP_SITE_RESERVE = "50";
  check("réserve > budget : enrichissement coupé, site intact", (await linkupGate(store(0), "q", now, "search", "enrich")).status === "blocked" && (await linkupGate(store(0), "q", now)).status === "call");
  if (previous.budget === undefined) delete process.env.LINKUP_DAILY_BUDGET;
  else process.env.LINKUP_DAILY_BUDGET = previous.budget;
  if (previous.reserve === undefined) delete process.env.LINKUP_SITE_RESERVE;
  else process.env.LINKUP_SITE_RESERVE = previous.reserve;
}

void finder().then(linkup).then(() => {
  console.log(failures ? `\n${failures} échec(s)` : "\nproduction mails : tout est vert");
  process.exit(failures ? 1 : 0);
});
