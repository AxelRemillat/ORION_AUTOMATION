/**
 * Cycle de vie d'un scan observable.
 *
 * Deux pieges que ces tests verrouillent :
 *   - un scan dont la fonction serverless a ete coupee reste « running » pour
 *     toujours en base ; l'ecran afficherait une barre qui n'avance plus ;
 *   - la progression vient d'une colonne jsonb, donc d'un objet dont rien ne
 *     garantit la forme : l'affichage ne doit jamais rendre « undefined ».
 *
 * Execution : `npm run test:search-runs`.
 */
import {
  EMPTY_PROGRESS,
  SCAN_SHARE,
  STALE_AFTER_MS,
  effectiveStatus,
  isStale,
  progressRatio,
  readProgress,
} from "../lib/search/runs";
import type { SearchRun } from "../types";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = Date.parse("2026-09-25T20:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const run = (over: Partial<SearchRun>): SearchRun => ({
  id: "r1",
  user_id: "u1",
  criteria: {},
  status: "running",
  progress: {},
  results: [],
  warnings: [],
  error: null,
  stop_requested: false,
  created_at: ago(60_000),
  updated_at: ago(1_000),
  ...over,
});

console.log("\n1. Un scan coupe en vol ne reste pas « en cours » a vie");
{
  check("frais -> toujours en cours", !isStale(run({ updated_at: ago(5_000) }), NOW));
  check(
    "silencieux au-dela du seuil -> perime",
    isStale(run({ updated_at: ago(STALE_AFTER_MS + 1_000) }), NOW),
  );
  check(
    "l'ecran le presente comme interrompu",
    effectiveStatus(run({ updated_at: ago(STALE_AFTER_MS + 1_000) }), NOW) === "stopped",
  );
  check(
    "un scan fini n'est jamais perime, meme ancien",
    !isStale(run({ status: "done", updated_at: ago(86_400_000) }), NOW),
  );
  check(
    "et garde son statut",
    effectiveStatus(run({ status: "done", updated_at: ago(86_400_000) }), NOW) === "done",
  );
}

console.log("\n2. La progression lue d'un jsonb ne rend jamais « undefined »");
{
  const empty = readProgress(run({ progress: {} }));
  check("compteurs a zero", empty.scanned === 0 && empty.withSignal === 0 && empty.analysed === 0);
  check("etape par defaut lisible", empty.step.length > 0, empty.step);

  check("phase par defaut = annuaire", empty.phase === "annuaire");

  const garbage = readProgress(run({ progress: { scanned: "douze", step: 42, phase: "???" } }));
  check("une phase inconnue retombe sur annuaire", garbage.phase === "annuaire", garbage.phase);
  check("un type inattendu retombe sur zero", garbage.scanned === 0, String(garbage.scanned));
  check("un libelle inattendu retombe sur le defaut", typeof garbage.step === "string");

  const real = readProgress(
    run({
      progress: {
        phase: "fiches",
        pagesRead: 2,
        pagesPlanned: 8,
        scanned: 34,
        withSignal: 3,
        analysed: 1,
        analysedPlanned: 5,
        step: "Lecture de l'annuaire 2/8",
      },
    }),
  );
  check("la phase est reprise", real.phase === "fiches");
  check("la cible de fiches est reprise", real.analysedPlanned === 5);
  check("les vraies valeurs passent", real.scanned === 34 && real.withSignal === 3 && real.analysed === 1);
  check("l'etape est reprise telle quelle", real.step === "Lecture de l'annuaire 2/8", real.step);

  check("aucun run -> valeurs sures", readProgress(null).scanned === 0);
}

console.log("\n3. La progression initiale est deja affichable");
{
  check("etape annoncee des l'ouverture", EMPTY_PROGRESS.step.length > 0, EMPTY_PROGRESS.step);
  check(
    "tous les compteurs a zero",
    EMPTY_PROGRESS.scanned === 0 &&
      EMPTY_PROGRESS.withSignal === 0 &&
      EMPTY_PROGRESS.analysed === 0 &&
      EMPTY_PROGRESS.pagesRead === 0,
  );
}

console.log("\n4. La barre avance, ne recule jamais, et ne finit qu'a la fin");
{
  const at = (over: Partial<typeof EMPTY_PROGRESS>) => progressRatio({ ...EMPTY_PROGRESS, ...over });

  check("plan inconnu -> a peine entamee, pas vide", at({}) > 0 && at({}) < 0.1);
  check(
    "annuaire a moitie lu -> moitie de la part scan",
    Math.abs(at({ pagesRead: 4, pagesPlanned: 8 }) - SCAN_SHARE / 2) < 1e-9,
  );
  check(
    "annuaire entierement lu -> la part scan, pas 100 %",
    Math.abs(at({ pagesRead: 8, pagesPlanned: 8 }) - SCAN_SHARE) < 1e-9,
  );

  // Le piege que ce test verrouille : la phase 2 doit REPRENDRE la barre la ou
  // la phase 1 l'a laissee, jamais la ramener en arriere.
  const endOfScan = at({ pagesRead: 8, pagesPlanned: 8 });
  const startOfFiches = at({ phase: "fiches", analysed: 0, analysedPlanned: 5 });
  check("la phase 2 reprend sans recul", startOfFiches >= endOfScan, String(startOfFiches));

  const series = [0, 1, 2, 3, 4, 5].map((analysed) =>
    at({ phase: "fiches", analysed, analysedPlanned: 5 }),
  );
  check(
    "les fiches font monter la barre de facon monotone",
    series.every((value, index) => index === 0 || value >= series[index - 1]),
    series.join(" "),
  );
  check("toutes les fiches ouvertes -> 100 %", Math.abs(series[5] - 1) < 1e-9);
  check(
    "jamais au-dela de 100 %, meme si le compte deborde",
    at({ phase: "fiches", analysed: 9, analysedPlanned: 5 }) === 1,
  );
  check(
    "aucune fiche a ouvrir -> barre pleine, pas bloquee a 80 %",
    at({ phase: "fiches", analysed: 0, analysedPlanned: 0 }) === 1,
  );
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
