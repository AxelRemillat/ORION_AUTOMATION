/**
 * Production de mails (Cowork #27) : entonnoir chiffré et réserve Linkup des recherches de
 * site. Aucun réseau, aucun crédit réel.
 */
import { buildProductionFunnel, costFamily, type FunnelSignal } from "../lib/funnel/production-funnel";
import { linkupGate, linkupSiteReserve, type LinkupGateStore } from "../lib/linkup/gate";

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

void linkup().then(() => {
  console.log(failures ? `\n${failures} échec(s)` : "\nproduction mails : tout est vert");
  process.exit(failures ? 1 : 0);
});
