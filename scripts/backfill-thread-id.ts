/**
 * RATTRAPAGE DE messages.thread_id (Cowork #53). Jusqu'à #53, ORION lisait `thread_id` dans la réponse du
 * workflow d'envoi n8n, qui renvoie en fait `gmail_thread_id` : aucun fil Gmail n'a été enregistré.
 *
 *   npx tsx scripts/backfill-thread-id.ts                                  # lecture seule (défaut)
 *   npx tsx scripts/backfill-thread-id.ts --expect <gmail_id>=<thread_id> …  # vérifie la règle sur des fils RÉELS
 *   npx tsx scripts/backfill-thread-id.ts --apply                          # écrit (si la règle est vérifiée)
 *
 * RÈGLE : une intro ouvre un nouveau fil Gmail, dont l'identifiant est celui de son premier message →
 * thread_id(intro) = gmail_message_id(intro) ; une relance part dans ce fil → thread_id(relance) = celui de
 * l'intro du même prospect. Les réponses à un mail reçu (`reponse`) ne sont pas touchées.
 *
 * VÉRIFICATION avant toute écriture : la règle est comparée aux fils réels connus — ceux déjà enregistrés en
 * base (envois postérieurs à #53) et ceux passés par `--expect` (lus dans les exécutions n8n). `--apply` est
 * refusé au moindre écart, ou avec moins de MIN_VERIFIED concordances. N'écrit que des thread_id vides.
 * Aucun envoi, aucune suppression.
 */
import { db, ownerId } from "./quality-live";

const MIN_VERIFIED = 6;

type Row = { id: string; prospect_id: string; type: string; sent_at: string; gmail_message_id: string | null; thread_id: string | null };

async function main() {
  const apply = process.argv.includes("--apply");
  const expected = new Map<string, string>();
  process.argv.forEach((arg, i) => {
    if (arg !== "--expect") return;
    for (const pair of process.argv.slice(i + 1).filter((a) => !a.startsWith("--"))) {
      const [gmail, thread] = pair.split("=");
      if (gmail && thread) expected.set(gmail.trim(), thread.trim());
    }
  });

  const userId = await ownerId();
  const loose = db as never as { from: (table: string) => any };
  const { data } = await loose
    .from("messages")
    .select("id, prospect_id, type, sent_at, gmail_message_id, thread_id")
    .eq("user_id", userId)
    .eq("status", "sent")
    .in("type", ["intro", "relance_1", "relance_2"])
    .order("sent_at");
  const rows = (data ?? []) as Row[];

  // Fil attendu par prospect : l'identifiant Gmail de SON intro (une seule intro envoyée, sinon on ne devine pas).
  const intros = new Map<string, Row[]>();
  for (const row of rows) if (row.type === "intro" && row.gmail_message_id) intros.set(row.prospect_id, [...(intros.get(row.prospect_id) ?? []), row]);
  const ruleThread = (row: Row): string | null => {
    const list = intros.get(row.prospect_id) ?? [];
    return list.length === 1 ? (list[0].gmail_message_id as string) : null;
  };

  // 1. Vérification de la règle sur les fils réels connus.
  let agree = 0;
  const disagree: string[] = [];
  for (const row of rows) {
    const real = row.thread_id ?? (row.gmail_message_id ? expected.get(row.gmail_message_id) : undefined);
    if (!real) continue;
    const rule = ruleThread(row);
    if (!rule) continue;
    if (rule === real) agree += 1;
    else disagree.push(`${row.type} ${row.sent_at.slice(0, 16)} : règle ${rule} ≠ réel ${real}`);
  }
  const unknownExpected = [...expected.keys()].filter((gmail) => !rows.some((row) => row.gmail_message_id === gmail));

  // 2. Lignes à rattraper.
  const todo = rows
    .filter((row) => !row.thread_id)
    .map((row) => ({ row, thread: ruleThread(row) }))
    .filter((entry): entry is { row: Row; thread: string } => Boolean(entry.thread));
  const skipped = rows.filter((row) => !row.thread_id && !ruleThread(row)).length;
  const byType = todo.reduce<Record<string, number>>((acc, { row }) => ({ ...acc, [row.type]: (acc[row.type] ?? 0) + 1 }), {});

  console.log(`${apply ? "APPLICATION" : "LECTURE SEULE"} — messages envoyés (intro, relances) : ${rows.length}`);
  console.log(`Vérification de la règle : ${agree} concordance(s), ${disagree.length} écart(s)${expected.size ? ` (dont ${expected.size} fil(s) fourni(s) par --expect)` : ""}.`);
  for (const line of disagree) console.log(`  ÉCART ${line}`);
  if (unknownExpected.length) console.log(`  --expect inconnus en base : ${unknownExpected.join(", ")}`);
  console.log(`À rattraper : ${todo.length} ${JSON.stringify(byType)} · sans règle sûre (aucune intro, ou plusieurs) : ${skipped}`);

  if (!apply) return;
  if (disagree.length || agree < MIN_VERIFIED) {
    console.log(`\nRefusé : la règle doit être vérifiée sur au moins ${MIN_VERIFIED} fils réels sans aucun écart (${agree} concordance(s), ${disagree.length} écart(s)). Rien n'est écrit.`);
    process.exitCode = 1;
    return;
  }
  let written = 0;
  for (const { row, thread } of todo) {
    const { data: updated } = await loose.from("messages").update({ thread_id: thread }).eq("id", row.id).eq("user_id", userId).is("thread_id", null).select("id");
    written += updated?.length ?? 0;
  }
  console.log(`\nÉcrit : ${written} thread_id (vides seulement).`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
