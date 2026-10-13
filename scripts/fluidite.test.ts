/**
 * Fluidité (Cowork #23) : règles du rafraîchissement automatique, mise à jour
 * optimiste des opportunités, lecture parallèle des statistiques de variantes.
 */
import { AUTO_REFRESH_MS, freshnessLabel, isTyping, shouldRefresh } from "../lib/auto-refresh";
import { optimisticPatch } from "../lib/opportunities/optimistic";
import { loadVariantStats } from "../lib/variants/load";
import { lastPrepareHealth } from "../lib/today/auto-run";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\n1. Rafraîchissement automatique toutes les 60 s");
  const idle = { visible: true, activeTag: "BODY", activeEditable: false, activeType: null, editing: false };
  check("60 secondes", AUTO_REFRESH_MS === 60_000);
  check("onglet visible, rien en saisie → rafraîchit", shouldRefresh(idle));
  check("onglet caché → en pause", !shouldRefresh({ ...idle, visible: false }));
  check("zone de texte (mail, note) active → jamais", !shouldRefresh({ ...idle, activeTag: "TEXTAREA" }));
  check("champ texte (objet, montant) actif → jamais", !shouldRefresh({ ...idle, activeTag: "INPUT", activeType: "text" }) && !shouldRefresh({ ...idle, activeTag: "INPUT", activeType: "date" }));
  check("liste déroulante ou contenu éditable actif → jamais", !shouldRefresh({ ...idle, activeTag: "SELECT" }) && !shouldRefresh({ ...idle, activeEditable: true }));
  check("éditeur ouvert (data-editing) → jamais", !shouldRefresh({ ...idle, editing: true }));
  check("un bouton ou une case cochée ne bloque pas", !isTyping({ activeTag: "BUTTON", activeEditable: false, editing: false }) && !isTyping({ activeTag: "INPUT", activeType: "checkbox", activeEditable: false, editing: false }));
  check("indicateur : à l'instant, 45 s, 3 min", freshnessLabel(0, 2_000) === "à jour à l'instant" && freshnessLabel(0, 45_000) === "à jour il y a 45 s" && freshnessLabel(0, 200_000) === "à jour il y a 3 min");

  console.log("\n2. Actions optimistes (opportunités)");
  const now = new Date("2026-10-12T10:00:00Z");
  check("« Vu » → seen_at tout de suite", optimisticPatch({ seen: true }, now).seen_at === now.toISOString());
  check("« Marquer envoyée » → statut et vue tout de suite", optimisticPatch({ status: "envoyee", seen: true }, now).status === "envoyee" && optimisticPatch({ status: "envoyee", seen: true }, now).seen_at === now.toISOString());
  check("notes, montant : tels quels ; « seen » n'est pas une colonne", optimisticPatch({ notes: "rappeler", amount_eur: 400 }).notes === "rappeler" && !("seen" in optimisticPatch({ seen: true })));

  console.log("\n3. Statistiques de variantes : deux lectures EN PARALLÈLE, familles fournies");
  const started: string[] = [];
  let concurrent = 0;
  let peak = 0;
  const query = (table: string, rows: Record<string, unknown>[]) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "order", "is", "range"]) builder[name] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => {
      started.push(table);
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      return new Promise((done) => setTimeout(done, 20)).then(() => {
        concurrent -= 1;
        return resolve({ data: rows, error: null });
      });
    };
    return builder;
  };
  const db = {
    from: (table: string) =>
      table === "message_variants"
        ? query(table, [{ message_id: "m1", family: "F3", hook_type: "x", messages: { prospect_id: "p1", sent_at: "2026-10-01T09:00:00Z", status: "sent", deleted_at: null } }])
        : query(table, []),
  };
  const result = await loadVariantStats(db);
  check("variantes et réponses lues en même temps (plus l'une après l'autre)", peak >= 2 && started.includes("message_variants") && started.includes("inbound_messages"), `pic ${peak}`);
  check("famille de chaque message rendue (le pipeline n'a plus à la relire)", result.families.get("m1") === "F3" && result.sends === 1);

  console.log("\n4. Aujourd'hui (Cowork #25) : santé de la préparation en une seule vague de lectures");
  {
    let active = 0;
    let most = 0;
    const job = { status: "done", error: null, created_at: "2026-10-12T05:00:00Z", finished_at: "2026-10-12T05:10:00Z", progress: null };
    const drafts = [
      { error: "quota", created_at: "2026-10-12T05:05:00Z" },
      { error: "ancien", created_at: "2026-10-10T05:05:00Z" },
    ];
    const healthDb = {
      from: () => {
        let single = false;
        const builder: Record<string, unknown> = {};
        for (const name of ["select", "eq", "order", "limit", "gte"]) builder[name] = () => builder;
        builder.maybeSingle = () => ((single = true), builder);
        builder.then = (resolve: (value: unknown) => unknown) => {
          active += 1;
          most = Math.max(most, active);
          return new Promise((done) => setTimeout(done, 15)).then(() => {
            active -= 1;
            return resolve({ data: single ? job : drafts, error: null });
          });
        };
        return builder;
      },
    };
    const health = await lastPrepareHealth(healthDb, "u1", new Date("2026-10-12T09:00:00Z"));
    check("dernière préparation et brouillons ratés lus EN MÊME TEMPS", most >= 2, `pic ${most}`);
    check("seuls les brouillons ratés depuis la dernière préparation comptent", health?.failedDrafts === 1 && health.firstDraftError === "quota", JSON.stringify(health));
  }

  console.log(failures === 0 ? "\nTous les tests fluidité passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
