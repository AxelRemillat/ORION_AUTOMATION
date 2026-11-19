/**
 * PAUSE DE LA PROSPECTION PAR E-MAIL (Cowork #117) : `PROSPECTION_EMAIL_ACTIVE` absent ou ≠ « true » ⇒ AUCUN appel
 * payant (Hunter, Pappers, Linkup), aucun job (préparation de 5 h, rédaction, régénération), aucun dépilage, routes
 * de prospection en HTTP 423.
 *
 * Le `fetch` global est remplacé par un espion qui ÉCHOUE le test s'il est appelé : la preuve qu'aucune requête ne
 * part. Aucun réseau, aucune base. `npm run test:pause-prospection`
 */
import { appelPayantAutorise, PROSPECTION_EN_PAUSE, prospectionEmailActive, refusSiPause } from "../lib/prospection/pause";
import { fetchPappers } from "../lib/enrichment/pappers";
import { fetchPage, fetchWebResults } from "../lib/enrichment/linkup";
import { hunter } from "../lib/contact-finder/clients";
import { createJob } from "../lib/jobs/store";
import { drainJobs } from "../lib/jobs/background";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

/** Espion : compte les appels réseau ; pendant la pause, il ne doit jamais être appelé. */
let appelsReseau: string[] = [];
const fetchEspion = (async (url: string | URL | Request) => {
  appelsReseau.push(String(url));
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

/** Fausse base qui échoue si on la touche (création ou dépilage de job pendant la pause). */
const baseInterdite = new Proxy({}, {
  get() {
    throw new Error("la base ne doit pas être touchée pendant la pause");
  },
});

async function main() {
  console.log("drapeau");
  check("absent = pause", prospectionEmailActive({}) === false);
  check("« false » = pause", prospectionEmailActive({ PROSPECTION_EMAIL_ACTIVE: "false" }) === false);
  check("vide ou valeur quelconque = pause", !prospectionEmailActive({ PROSPECTION_EMAIL_ACTIVE: "" }) && !prospectionEmailActive({ PROSPECTION_EMAIL_ACTIVE: "1" }) && !prospectionEmailActive({ PROSPECTION_EMAIL_ACTIVE: "yes" }));
  check("seul « true » réactive (casse et espaces tolérés)", prospectionEmailActive({ PROSPECTION_EMAIL_ACTIVE: " TRUE " }));
  check("appel payant refusé en pause", !appelPayantAutorise("hunter", {}) && !appelPayantAutorise("pappers", {}) && !appelPayantAutorise("linkup", {}));
  check("appel payant permis si actif", appelPayantAutorise("hunter", { PROSPECTION_EMAIL_ACTIVE: "true" }));

  // Pause effective, clés présentes : sans le drapeau, ces appels partiraient.
  delete process.env.PROSPECTION_EMAIL_ACTIVE;
  process.env.PAPPERS_API_KEY = "cle-de-test";
  process.env.HUNTER_API_KEY = "cle-de-test";
  process.env.LINKUP_API_KEY = "cle-de-test";
  const fetchOrigine = globalThis.fetch;
  globalThis.fetch = fetchEspion;
  appelsReseau = [];

  console.log("\nappels payants pendant la pause");
  let fetchJsonAppels = 0;
  const pappers = await fetchPappers("552100554", {
    cache: { read: async () => null, write: async () => undefined },
    allowance: async () => ({ allowed: true }),
    fetchJson: (async () => {
      fetchJsonAppels += 1;
      return { ok: true, data: {} };
    }) as never,
  });
  check("Pappers : refusé, aucun appel", !pappers.ok && fetchJsonAppels === 0, pappers);
  check("Pappers : message de pause", !pappers.ok && pappers.error.includes("PROSPECTION_EMAIL_ACTIVE"), pappers);
  const web = await fetchWebResults({ name: "Boulangerie du Pont", city: "Vizille" });
  check("Linkup recherche : refusée", !web.ok && web.error.includes("PROSPECTION_EMAIL_ACTIVE"), web);
  const page = await fetchPage("https://exemple.fr");
  check("Linkup lecture de page : refusée", !page.ok && page.error.includes("PROSPECTION_EMAIL_ACTIVE"), page);
  const h = await hunter("domain-search", { domain: "exemple.fr" });
  check("Hunter : aucune donnée, rien de facturé", h.data === null && h.billed === false, h);
  check("AUCUNE requête réseau", appelsReseau.length === 0, appelsReseau);

  console.log("\njobs pendant la pause (préparation de 5 h, rédaction, régénération)");
  for (const type of ["search_signals", "email_generate", "email_rewrite", "reanalyze", "search_criteria"] as const) {
    const r = await createJob(baseInterdite, { type, target: "x", params: { kind: "prepare" } } as never);
    check(`${type} : refusé sans toucher la base`, "error" in r && r.error === PROSPECTION_EN_PAUSE, r);
  }
  const resteAFaire = await drainJobs(baseInterdite as never);
  check("dépilage : rien n'est pris, la base n'est pas touchée", resteAFaire === false);

  console.log("\nroutes de prospection");
  const refus = refusSiPause({});
  check("HTTP 423 en pause", refus?.status === 423);
  const corps = refus ? ((await refus.json()) as { error: string; paused: boolean }) : null;
  check("message lisible et drapeau « paused »", corps?.paused === true && corps.error === PROSPECTION_EN_PAUSE, corps);
  check("aucun refus si actif", refusSiPause({ PROSPECTION_EMAIL_ACTIVE: "true" }) === null);

  globalThis.fetch = fetchOrigine;
  console.log(failures === 0 ? "\nTous les tests de la pause de la prospection passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
