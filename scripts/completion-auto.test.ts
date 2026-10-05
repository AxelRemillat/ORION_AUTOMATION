/**
 * Complétion automatique des fiches (Cowork, 05/10/2026) — fixtures uniquement,
 * faux réseau : aucune recherche Linkup, aucun appel Hunter, aucun DNS réel.
 *
 * Exécution : `npm run test:completion`.
 */
import { FakeDb } from "./fake-supabase";
import { linkupGate, linkupCacheKey, linkupDailyBudget, type LinkupGateStore } from "../lib/linkup/gate";
import { candidateDomains, LINKUP_MIN_SCORE, MIN_SITE_CONFIDENCE, resolveSite, siteIdentity } from "../lib/contact-finder/free-site";
import { completeOne, UNREACHABLE_AFTER, type CompletionDeps } from "../lib/today/complete";
import { exclusionOf } from "../lib/today/items";
import { subsidiaryOf } from "../lib/enrichment/subsidiary";
import { offTargetReason } from "../lib/funnel/off-target";
import { FUNNEL_FT_DAYS, FUNNEL_ROME_CODES, toJobSignal } from "../lib/signals/france-travail";
import { painForJob } from "../lib/funnel/pain-map";
import { thirdPartyEmployer } from "../lib/emails/quality/third-party";
import { runSiteStage } from "../lib/funnel/site-priority";
import { reopenUnexamined } from "../lib/funnel/store";
import type { ContactDeps } from "../lib/contact-finder/finder";
import type { Db } from "../lib/trash/scope";
import type { Prospect, SignalCandidateRow } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Faux web : chaque domaine renvoie la page donnée ; tout appel payant est noté. */
function fakeWeb(pages: Record<string, string>, search: { url: string; title: string; snippet: string }[] = []) {
  const paid: string[] = [];
  const deps: ContactDeps = {
    fetchHtml: async (url: string) => {
      const host = url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
      const html = pages[host];
      return html ? { url, html: `<html><body>${html}</body></html>` } : null;
    },
    webSearch: async () => (paid.push("linkup"), search),
    hunterDomainSearch: async () => (paid.push("hunter"), []),
    hunterFinder: async () => (paid.push("hunter"), null),
    hunterVerify: async () => (paid.push("hunter"), null),
  };
  return { deps, paid };
}

const SAIREM = siteIdentity({ name: "SAIREM SOCIETE POUR L APPLICATION INDUSTRIELLE (SAIREM)", siren: "123456789", city: "DECINES-CHARPIEU" });
const LEGAL_PAGE = "SAIREM — fours micro-ondes industriels. Mentions légales : SAIREM, SIREN 123 456 789, Décines-Charpieu.";

async function main() {
  console.log("\n1. Garde-fou Linkup : plafond du jour, cache 90 jours");
  {
    const memory = new Map<string, unknown>();
    const store = (used: number): LinkupGateStore => ({
      read: async (key) => memory.get(key) ?? null,
      write: async (key, value) => void memory.set(key, value),
      usedSince: async () => used,
    });
    check("défaut : 30 recherches par jour", linkupDailyBudget({}) === 30);
    check("LINKUP_DAILY_BUDGET=0 coupe Linkup", (await (async () => { const before = process.env.LINKUP_DAILY_BUDGET; process.env.LINKUP_DAILY_BUDGET = "0"; const r = await linkupGate(store(0), "x"); process.env.LINKUP_DAILY_BUDGET = before ?? ""; if (before === undefined) delete process.env.LINKUP_DAILY_BUDGET; return r.status; })()) === "blocked");
    check("budget du jour atteint : refusé", (await linkupGate(store(30), "acme lyon site officiel")).status === "blocked");
    check("sous le budget : appel permis", (await linkupGate(store(3), "acme lyon site officiel")).status === "call");
    memory.set(linkupCacheKey("ACME  Lyon site officiel"), [{ url: "https://acme.fr" }]);
    check("même requête déjà payée : servie par le cache, sans appel", (await linkupGate(store(30), "acme lyon site officiel")).status === "cache");
  }

  console.log("\n2. Résolution du site : ordre, validation stricte, jamais un annuaire");
  {
    check("« (SAIREM) » : le sigle entre parenthèses passe en tête", candidateDomains([SAIREM.legalName])[0] === "sairem.fr", candidateDomains([SAIREM.legalName]).join(","));
    const offer = fakeWeb({ "sairem-industrie.com": LEGAL_PAGE, "sairem.fr": LEGAL_PAGE });
    const fromOffer = await resolveSite(SAIREM, offer.deps, { knownUrls: ["https://www.sairem-industrie.com/"], score: 5 });
    check("a. site de l'offre France Travail validé en premier", fromOffer.site?.by === "offre" && fromOffer.site.domain === "sairem-industrie.com", JSON.stringify(fromOffer));
    const guessed = await resolveSite(SAIREM, fakeWeb({ "sairem.fr": LEGAL_PAGE }).deps, { score: 5 });
    check("b. sinon domaine déduit du nom (gratuit)", guessed.site?.by === "domaine" && guessed.linkupQueries === 0);
    const search = [
      { url: "https://www.societe.com/societe/sairem-123456789.html", title: "SAIREM", snippet: "" },
      { url: "https://fr.linkedin.com/company/sairem", title: "SAIREM", snippet: "" },
      { url: "https://www.indeed.fr/cmp/sairem", title: "SAIREM", snippet: "" },
      { url: "https://microondes-sairem.com/fr/", title: "SAIREM", snippet: "" },
    ];
    const web = fakeWeb({ "microondes-sairem.com": LEGAL_PAGE, "societe.com": LEGAL_PAGE, "fr.linkedin.com": LEGAL_PAGE }, search);
    const viaLinkup = await resolveSite(SAIREM, web.deps, { score: 4 });
    check("c. Linkup en dernier, score ≥ 4 : une requête", viaLinkup.site?.by === "linkup" && viaLinkup.linkupQueries === 1 && web.paid.join() === "linkup", JSON.stringify(viaLinkup) + web.paid.join());
    check("   annuaire, réseau social, site d'emploi jamais retenus", viaLinkup.site?.domain === "microondes-sairem.com");
    const low = fakeWeb({}, search);
    const lowScore = await resolveSite(SAIREM, low.deps, { score: LINKUP_MIN_SCORE - 1 });
    check("score < 4 : aucune recherche Linkup", lowScore.site === null && low.paid.length === 0, low.paid.join());
    const nameOnly = await resolveSite(SAIREM, fakeWeb({ "sairem.fr": "Bienvenue chez SAIREM SOCIETE POUR L APPLICATION INDUSTRIELLE, fours industriels." }).deps, { score: 1 });
    check(`raison sociale seule (sans SIREN ni ville) : refusée (seuil ${MIN_SITE_CONFIDENCE})`, nameOnly.site === null, JSON.stringify(nameOnly));
    check("aucun appel Hunter pendant la recherche de site", ![offer, web, low].some((item) => item.paid.includes("hunter")));
  }

  console.log("\n3. Complétion : site d'abord, MX, profil, « Non joignable »");
  {
    const row = (attempts: number) =>
      ({ id: "c1", prospect_id: "p1", contact: { attempts }, facts: {}, triage: { score: 4 }, score: 4 }) as unknown as SignalCandidateRow;
    const calls: string[] = [];
    const deps = (over: Partial<CompletionDeps>): CompletionDeps => ({
      findContact: async () => (calls.push("contact"), { confidence: 0, found_by: "aucun" }),
      resolveSite: async () => (calls.push("site"), null),
      readProfile: async () => void calls.push("profil"),
      hasMx: async () => true,
      markUnreachable: async (_id, reason) => void calls.push(`injoignable:${reason}`),
      ...over,
    });
    let db = new FakeDb({ signal_candidates: [{ id: "c1", contact: { attempts: 0 } }] });
    await completeOne(db as unknown as Db, row(0), { deps: deps({ resolveSite: async () => (calls.push("site"), { website: "https://acme.fr", found: true }), findContact: async () => (calls.push("contact"), { email: "contact@acme.fr", confidence: 80, found_by: "site:contact" }) }), runId: "r1" });
    check("ordre : site, puis email, puis profil (site tout juste trouvé)", calls.join(",") === "site,contact,profil", calls.join(","));
    check("site et email gardés sur la fiche candidate", (db.rows("signal_candidates")[0].contact as { website?: string }).website === "https://acme.fr" && db.rows("signal_candidates")[0].publication === "pret");

    calls.length = 0;
    db = new FakeDb({ signal_candidates: [{ id: "c1", contact: { attempts: 0 } }] });
    const noMx = await completeOne(db as unknown as Db, row(0), { deps: deps({ findContact: async () => ({ email: "info@ancien-domaine.fr", confidence: 60, found_by: "site:contact" }), hasMx: async () => false }), runId: "r1" });
    check("adresse sur un domaine sans MX : écartée", !noMx.found && db.rows("signal_candidates")[0].publication === "a_completer");

    calls.length = 0;
    db = new FakeDb({ signal_candidates: [{ id: "c1", contact: { attempts: UNREACHABLE_AFTER - 1 } }] });
    const third = await completeOne(db as unknown as Db, row(UNREACHABLE_AFTER - 1), { deps: deps({}), runId: "r3" });
    check("3e tentative sans site ni email : « Non joignable »", third.unreachable && calls.some((call) => call.startsWith("injoignable:3 tentatives")), calls.join(","));
    calls.length = 0;
    const early = await completeOne(new FakeDb({ signal_candidates: [{ id: "c1", contact: { attempts: 0 } }] }) as unknown as Db, row(0), { deps: deps({}), runId: "r1" });
    check("1re tentative ratée : pas encore « Non joignable »", !early.unreachable && !calls.some((call) => call.startsWith("injoignable")));
    calls.length = 0;
    const withSite = await completeOne(new FakeDb({ signal_candidates: [{ id: "c1", contact: { attempts: 2 } }] }) as unknown as Db, row(2), { deps: deps({ resolveSite: async () => ({ website: "https://acme.fr", found: false }) }), runId: "r3" });
    check("site connu mais pas d'email : reste « À compléter » (formulaire de contact)", !withSite.unreachable);
    calls.length = 0;
    const dbBlocked = new FakeDb({ signal_candidates: [{ id: "c1", contact: { attempts: 2 } }] });
    const blocked = await completeOne(dbBlocked as unknown as Db, row(2), { deps: deps({ resolveSite: async () => ({ unreadable: "sairem.com" }) }), runId: "r3" });
    check("site protégé contre les robots (403) : jamais « Non joignable », raison gardée", !blocked.unreachable && (dbBlocked.rows("signal_candidates")[0].contact as { site_unreadable?: string }).site_unreadable === "sairem.com");

    const fiche = (figures: Record<string, unknown>, name = "ACME") => ({ company_name: name, key_figures: figures, size_range: null, do_not_contact: false }) as unknown as Prospect;
    check("« Non joignable » : sort de « Aujourd'hui »", exclusionOf(fiche({ unreachable: { reason: "3 tentatives sans site ni email" } }))?.startsWith("non joignable") === true);
  }

  console.log("\n4. Filiale de groupe : pas proposée par défaut");
  {
    const mavi = { company_name: "MAVIFLEX", size_range: null, key_figures: { leader: "CHRISTOPH PAUL STEPHAN HORMANN", leader_person: "Christoph Hormann", is_large_group_subsidiary: false } } as unknown as Prospect;
    check("MAVIFLEX (groupe Hörmann) : hors cible", offTargetReason(mavi)?.startsWith("filiale de groupe (Hörmann)") === true, String(offTargetReason(mavi)));
    check("ALERYS & COMPAGNIE pour ALERYS : holding familiale, pas un groupe", subsidiaryOf({ leader: "ALERYS & COMPAGNIE" }, "ALERYS") === null);
    check("TUPACK GROUPE pour NEUVISTAC : filiale", subsidiaryOf({ leader: "TUPACK GROUPE" }, "NEUVISTAC TUBES CARTON") === "TUPACK GROUPE");
    check("dirigeant personne physique : pas une filiale", subsidiaryOf({ leader: "JEAN DUPONT", leader_person: "Jean Dupont" }, "ACME") === null);
  }

  console.log("\n5. Offre France Travail : le site de l'entreprise est gardé");
  {
    const signal = toJobSignal({ intitule: "Comptable", dateCreation: "2026-10-01T08:00:00Z", entreprise: { nom: "TC TRANSPORT ADAPTE", url: "http://www.tc-transport.fr" }, lieuTravail: { libelle: "69 - LYON" }, id: "1" } as never);
    check("entreprise.url → employerUrl", signal?.employerUrl === "http://www.tc-transport.fr", JSON.stringify(signal));
    const none = toJobSignal({ intitule: "Comptable", dateCreation: "2026-10-01T08:00:00Z", entreprise: { nom: "ACME" }, id: "2" } as never);
    check("sans url : null", none?.employerUrl === null);
  }

  console.log("\n6. Run 2 : avant toute dépense, opposition et « signal pour un client »");
  {
    check("PB SOLUTIONS « assistance technique ou au forfait » : régie, hors cible", Boolean(thirdPartyEmployer({ activity: "Prestations d'ingénierie en assistance technique ou au forfait pour l'industrie." })));
    check("fabricant « assistance technique et SAV de nos machines » : PAS de la régie", thirdPartyEmployer({ activity: "Assistance technique et SAV de nos machines d'emballage." }) === null);
    check("« ingénieurs en régie » : exclu", Boolean(thirdPartyEmployer({ activity: "Nos ingénieurs interviennent en régie chez nos clients." })));
    check("PB SOLUTIONS, profil réel (ingénierie + assistance technique + recrutement de profils) : exclu", Boolean(thirdPartyEmployer({ activity: "Prestations d’ingénierie industrielle et managériale, assistance technique et recrutement de profils industriels en CDI." })));
    check("fabricant « assistance technique et maintenance sur site » : PAS exclu", thirdPartyEmployer({ activity: "Fabrication de fours micro-ondes industriels, assistance technique et maintenance sur site." }) === null);

    const base = { company_name: "ACME", siren: "123456789", city: "LYON", postal_code: "69001", website: null };
    const rows = [
      { id: "opp", statut: "retenu", triage: { score: 5 }, weight: 1, identity: { base: { ...base, siren: "111111111" } }, contact: null, badges: [] },
      { id: "regie", statut: "retenu", triage: { score: 4 }, weight: 1, identity: { base: { ...base, siren: "222222222" } }, contact: null, badges: [] },
      { id: "ok", statut: "retenu", triage: { score: 4 }, weight: 1, identity: { base: { ...base, siren: "333333333" } }, contact: null, badges: [] },
    ].map((row) => ({ ...row, user_id: "u", run_id: "r1" }));
    const db = new FakeDb({ signal_candidates: rows });
    const searched: string[] = [];
    const report = await runSiteStage(db as unknown as Db, "u", "r1", {
      checkOpposition: async (siren) => siren === "111111111",
      findSite: async (_identity, row) => (searched.push(row.id), { website: `https://${row.id}.fr`, domain: `${row.id}.fr`, confidence: 90 }),
      screenClient: async (website) => (website.includes("regie") ? "régie ou assistance technique" : null),
      deadline: Date.now() + 60_000,
    });
    const statut = (id: string) => db.rows("signal_candidates").find((row) => row.id === id) as Record<string, unknown>;
    check("opposée (INPI) : rejetée AVANT toute recherche de site", statut("opp").statut === "rejeté" && !searched.includes("opp"), JSON.stringify(statut("opp")));
    check("régie lue sur l'accueil : rejetée avant creusage, badge « signal pour un client »", statut("regie").statut === "rejeté" && (statut("regie").badges as string[]).includes("signal pour un client"));
    check("fiche saine : site gardé pour le creusage", (statut("ok").contact as { site_free?: { website?: string } }).site_free?.website === "https://ok.fr");
    check("compteurs du run", report.opposed === 1 && report.clients === 1 && report.found === 1, JSON.stringify(report));

    const fetchStore: LinkupGateStore = { read: async () => null, write: async () => undefined, usedSince: async (_since, kind) => (kind === "fetch" ? 59 : 30) };
    check("lectures de page : plafond à part (60), les recherches à 30/30 ne les bloquent pas", (await linkupGate(fetchStore, "https://acme.fr", new Date(), "fetch")).status === "call");
    check("recherches : toujours bloquées à 30/30", (await linkupGate(fetchStore, "acme lyon site officiel")).status === "blocked");
  }

  console.log("\n7. Reprise des signaux « non examinés » du run précédent");
  {
    const db = new FakeDb({ signal_candidates: [
      { id: "a", user_id: "u", run_id: "r1", hash: "h1", statut: "rejeté", motif_rejet: "non examiné : plafond de 600 signaux examinés par run" },
      { id: "b", user_id: "u", run_id: "r1", hash: "h2", statut: "rejeté", motif_rejet: "entreprise introuvable à l'annuaire" },
      { id: "c", user_id: "u", run_id: "r1", hash: "h3", statut: "retenu", motif_rejet: null },
    ] });
    const reopened = await reopenUnexamined(db as unknown as Db, "u", "r2", ["h1", "h2", "h3"]);
    const row = (id: string) => db.rows("signal_candidates").find((item) => item.id === id) as Record<string, unknown>;
    check("signal non examiné : repris dans le run courant, statut brut", reopened === 1 && row("a").run_id === "r2" && row("a").statut === "brut" && row("a").motif_rejet === null);
    check("rejeté pour un autre motif : inchangé", row("b").statut === "rejeté" && row("b").run_id === "r1");
    check("retenu : inchangé, rien n'est supprimé", row("c").statut === "retenu" && db.rows("signal_candidates").length === 3);
  }

  console.log("\n8. France Travail élargi (toute la France, 30 jours, back-office)");
  {
    const codes: readonly string[] = FUNNEL_ROME_CODES;
    check("codes ROME : assistanat, office manager, ADV, compta, facturation, recouvrement, achats, SAV, logistique", ["M1607", "M1604", "M1432", "D1409", "M1225", "M1611", "D1422", "N1303", "H1108", "N1210", "N1201"].every((code) => codes.includes(code)));
    check("M1602 (secrétaire de collectivité territoriale en ROME 4) retiré", !codes.includes("M1602"));
    check("offres de moins de 30 jours", FUNNEL_FT_DAYS === 30);
    for (const title of ["Office manager", "Assistant de direction", "Technicien support client", "Technicien SAV hotline", "Logisticien", "Affréteur", "Gestionnaire de commandes"]) {
      check(`intitulé reconnu : ${title}`, painForJob(title) !== null);
    }
    check("hors back-office toujours écarté (développeur, chauffeur)", painForJob("Développeur web") === null && painForJob("Chauffeur poids lourd") === null);
  }

  console.log(failures === 0 ? "\nTous les tests de complétion passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
