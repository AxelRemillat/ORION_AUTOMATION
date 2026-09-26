/**
 * Vérification réelle de l'accroche et du gating, sur des prospects de la base.
 *
 * Reproduit la route `/api/emails/generate` de bout en bout, avec les vraies
 * clés : Pappers pour rafraîchir les faits de registre, OpenAI pour le
 * stratège, le rédacteur et le juge. Rien n'est simulé — c'est le seul moyen
 * de savoir si le gating bloque ce qu'il doit bloquer et si les nouvelles
 * accroches sortent vraiment.
 *
 *   npx tsx scripts/verif-accroche.ts                 # les cas de la liste
 *   npx tsx scripts/verif-accroche.ts TERDICI DEVESA  # des noms au choix
 *   npx tsx scripts/verif-accroche.ts --facts         # faits seuls, 0 appel LLM
 *
 * CONSOMME DES CRÉDITS : un appel Pappers par prospect, trois appels OpenAI
 * par mail. À lancer en local, jamais en CI.
 */
import { existsSync, readFileSync } from "node:fs";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { chatJson, type AskFn } from "@/lib/ai/chat";
import { buildFacts } from "@/lib/emails/derived-facts";
import { hookReadiness } from "@/lib/emails/hook-readiness";
import { incomingLeader } from "@/lib/emails/incoming-leader";
import { runStrategist } from "@/lib/emails/strategist";
import { dateUndatedSignals, isHookFresh } from "@/lib/signals/dating";
import { fetchPappers } from "@/lib/enrichment/pappers";
import { searchBySignals } from "@/lib/signals";
import { defaultOffer } from "@/lib/offer/read";
import { wordCount } from "@/lib/emails/validate";
import { draftFromBrief } from "@/app/api/emails/generate/pipeline";
import { averageScore, CRITERIA_LABELS, type Critique } from "@/app/api/emails/generate/critic";
import type { Prospect } from "@/types";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const argv = process.argv.slice(2);
const factsOnly = argv.includes("--facts");
/** `--signaux=69=2,75=1` : va chercher des fiches a signal, sans passer par la base. */
const signauxArg = argv.find((item) => item.startsWith("--signaux="))?.split("=").slice(1).join("=");
/** `--source=france-travail` : verifie une source isolement. */
const sourceArg = argv.find((item) => item.startsWith("--source="))?.split("=")[1];
const names = argv.filter((item) => !item.startsWith("--"));

/** Les cas de la vérification : trois accroches attendues, un blocage attendu. */
const DEFAULT_CASES = ["SELECTION HABITAT", "TERDICI"];

const line = (label: string) => console.log(`\n${"=".repeat(74)}\n${label}\n${"=".repeat(74)}`);

async function prospectsByName(patterns: string[]): Promise<Prospect[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE absentes");

  const db = createClient(url, key, { auth: { persistSession: false } });
  const found: Prospect[] = [];
  for (const pattern of patterns) {
    const { data, error } = await db
      .from("prospects")
      .select("*")
      .is("deleted_at", null)
      .ilike("company_name", `%${pattern}%`)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`lecture ${pattern} : ${error.message}`);
    if (data?.[0]) found.push(data[0] as Prospect);
    else console.warn(`⚠️  aucun prospect « ${pattern} » en base`);
  }
  return found;
}

/**
 * Prospects à dirigeant entrant ou à offre récente, pris dans la base.
 *
 * On ne les nomme pas d'avance : le but est de vérifier la règle sur ce qui
 * existe vraiment, pas sur un cas choisi pour qu'il marche.
 */
async function prospectsWithSituation(kind: "dirigeant" | "emploi", limit: number): Promise<Prospect[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) return [];

  const db = createClient(url, key, { auth: { persistSession: false } });
  const column = kind === "dirigeant" ? "new_leader_name" : "job_title";
  const { data } = await db
    .from("prospects")
    .select("*")
    .is("deleted_at", null)
    .neq("status", "perdu")
    .not(`key_figures->>${column}`, "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit * 3);

  const rows = (data ?? []) as Prospect[];
  return rows.slice(0, limit);
}

/**
 * Rafraîchit les faits de registre : ouvertures d'établissements et date de
 * prise de poste. Les fiches enrichies avant ce travail ne les portent pas.
 */
async function refresh(prospect: Prospect): Promise<Prospect> {
  if (!prospect.siren) return prospect;
  const pappers = await fetchPappers(prospect.siren);
  if (!pappers.ok) {
    console.warn(`  ⚠️  Pappers ${prospect.company_name} : ${pappers.error}`);
    return prospect;
  }
  const openings = pappers.data.openings
    .filter((opening) => isHookFresh(opening.date))
    .slice(0, 3)
    .map((opening) => ({ city: opening.city, date: opening.date, sign: opening.sign }));

  return {
    ...prospect,
    key_figures: {
      ...prospect.key_figures,
      ...(pappers.data.leader_since ? { leader_since: pappers.data.leader_since } : {}),
      ...(openings.length ? { recent_openings: openings } : {}),
    },
  };
}

async function run(prospect: Prospect, ask: AskFn): Promise<void> {
  line(`${prospect.company_name} — SIREN ${prospect.siren ?? "?"}`);

  const fresh = await refresh(prospect);
  const figures = fresh.key_figures ?? {};
  const openings = Array.isArray(figures.recent_openings) ? figures.recent_openings : [];
  const leader = incomingLeader(figures);

  console.log(`Ouvertures < 12 mois : ${openings.length ? JSON.stringify(openings) : "aucune"}`);
  console.log(`Dirigeant entrant    : ${leader ? `${leader.fullName} (${leader.since})` : "aucun"}`);

  let facts = buildFacts(fresh, null);
  let readiness = hookReadiness(facts.facts);

  // Datation de rattrapage, exactement comme la route.
  if (!readiness.ready) {
    const dated = await dateUndatedSignals(fresh.signals ?? [], {
      siren: fresh.siren,
      city: fresh.city,
    });
    if (dated.changed) {
      console.log(`Datation de rattrapage : ${JSON.stringify(dated.signals.map((s) => s.date))}`);
      facts = buildFacts({ ...fresh, signals: dated.signals }, null);
      readiness = hookReadiness(facts.facts);
    }
  }

  // Ce qui a ete ECARTE compte autant que ce qui reste : un signal rejete pour
  // « non rattache » ou faute de citation explique un blocage.
  const shown = (fresh.signals ?? []).map(
    (signal) =>
      `${signal.label} [date=${signal.date ?? "nd"} url=${signal.url ? "oui" : "non"} quote=${signal.quote ? "oui" : "non"}]`,
  );
  console.log(`Signaux de la fiche  : ${shown.length ? shown.join(" · ") : "aucun"}`);
  if (facts.rejectedSignals.length) {
    console.log(
      `Signaux ecartes      : ${facts.rejectedSignals.map((item) => `${item.label} (${item.reason})`).join(" · ")}`,
    );
  }

  console.log(
    `\nFaits pouvant ouvrir : ${
      readiness.strong.length
        ? readiness.strong.map((fact) => `[${fact.key} r${fact.hookTier}] ${fact.value}`).join(" | ")
        : "AUCUN"
    }`,
  );

  if (!readiness.ready) {
    console.log(`\n⛔ BLOQUÉ — ${readiness.reason}`);
    return;
  }
  if (factsOnly) return;

  const outcome = await runStrategist(
    (system, user, operation) => ask("strategist", system, user, 0.2, operation),
    {
      facts: facts.facts,
      companyName: facts.companyName,
      isLargeGroupSubsidiary: facts.isLargeGroupSubsidiary,
      parentGroup: facts.parent,
      foreignEntities: facts.foreignEntities,
      history: [],
      excludeAngles: [],
      sector: fresh.sector,
    },
  );
  if (!outcome.brief) {
    console.log(`\n❌ brief inexploitable : ${outcome.error}`);
    return;
  }
  const brief = outcome.brief;
  console.log(
    `\nAngle ${brief.angle.type} sur ${brief.angle.hookFactIds.join(", ")} : ${brief.angle.insight}` +
      `\nPain  : ${brief.pain.task}\nPreuve: ${brief.proofId ?? "aucune"}\nCTA   : ${brief.cta}`,
  );

  const offer = defaultOffer();
  const draft = await draftFromBrief({
    offer,
    ask,
    brief,
    facts: facts.facts,
    tone: "direct",
    contact: null,
    prospectId: fresh.id,
    registryName: fresh.company_name,
    avoid: [],
    leaderPerson: facts.leaderPerson,
    addressee: leader?.fullName ?? null,
    forbiddenNames: facts.foreignEntities,
  });
  if ("error" in draft) {
    console.log(`\n❌ rédaction : ${draft.error}`);
    return;
  }

  console.log(`Reecrit : ${draft.rewritten ? "oui" : "non"}`);
  const signature = draft.email.body.split(/\n\n/).slice(-1)[0] ?? "";
  console.log(`\nObjet : ${draft.email.subject}\n\n${draft.email.body}\n`);
  console.log(
    `Mots hors signature : ${wordCount(draft.email.body) - wordCount(signature)} ` +
      `(cible 100, plafond 125)`,
  );
  console.log(
    `Validateurs : ${draft.validation.failures.length ? draft.validation.failures.join(" | ") : "aucun échec"}`,
  );
  if (draft.critique) {
    const critique = draft.critique as Critique;
    for (const key of Object.keys(CRITERIA_LABELS) as (keyof Critique)[]) {
      console.log(`  ${CRITERIA_LABELS[key]} : ${critique[key].score}/5 — ${critique[key].note}`);
    }
    console.log(`  MOYENNE : ${averageScore(critique).toFixed(1)}/5`);
  }
}

/**
 * Fiches a signal officiel, prises en direct au BODACC et a France Travail.
 *
 * Les prospects « nouveau dirigeant » et « offre d'emploi » n'existent pas
 * encore en base : ils naissent d'une recherche par signaux. On les construit
 * en memoire, sans rien inserer — la verification ne doit pas polluer la base.
 */
async function prospectsFromSignals(spec: string): Promise<Prospect[]> {
  const built: Prospect[] = [];

  for (const part of spec.split(",")) {
    const [departement, count] = part.split("=");
    const limit = Number(count) || 1;
    console.log(`
Recherche par signaux — departement ${departement}, ${limit} fiche(s)…`);

    const outcome = await searchBySignals({
      departement,
      // 10 a 249 salaries : la cible habituelle.
      tranches: ["11", "12", "21", "22"],
      days: 30,
      limit,
      ...(sourceArg === "bodacc" || sourceArg === "france-travail" ? { only: sourceArg } : {}),
    });
    console.log(
      `  sources : ${outcome.sources.map((source) => `${source.label} ${source.count}`).join(", ")}` +
        ` · signaux ${outcome.signalsFound} · fiches ${outcome.results.length}`,
    );
    for (const warning of outcome.warnings) console.log(`  ⚠️  ${warning.source} : ${warning.message}`);

    for (const company of outcome.results) {
      built.push({
        id: `signal-${company.siren ?? built.length}`,
        user_id: "verif",
        company_name: company.company_name,
        siren: company.siren,
        website: company.website,
        email: company.email,
        sector: company.sector,
        size_range: company.size_range,
        city: company.city,
        source: "auto",
        signals: company.signals ?? [],
        key_figures: company.key_figures,
        pain_point: null,
        status: "nouveau",
        created_at: "",
        updated_at: "",
      });
    }
  }
  return built;
}

async function main(): Promise<void> {
  const picked: Prospect[] = [];

  if (signauxArg) {
    picked.push(...(await prospectsFromSignals(signauxArg)));
  } else {
    picked.push(...(await prospectsByName(names.length ? names : DEFAULT_CASES)));
    // Fiches a dirigeant entrant ou a offre recente deja presentes en base.
    if (!names.length) {
      picked.push(...(await prospectsWithSituation("dirigeant", 2)));
      picked.push(...(await prospectsWithSituation("emploi", 1)));
    }
  }

  const unique = picked.filter((row, index) => picked.findIndex((other) => other.id === row.id) === index);
  console.log(`${unique.length} fiche(s) : ${unique.map((row) => row.company_name).join(", ")}`);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const ask: AskFn = (role, system, user, temperature, operation) =>
    chatJson({ client, role, system, user, temperature, operation });

  for (const prospect of unique) {
    await run(prospect, ask).catch((cause) => console.error(`❌ ${prospect.company_name} :`, cause));
  }
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
