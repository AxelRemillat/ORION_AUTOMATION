/**
 * RELANCES À 9/10 (Cowork #12) — PAYANT, plafond dur 0,55 € (≈ 0,6 $).
 *
 *   npm run relances:9 -- --etalonnage   8 prospects réels en attente de relance
 *                                        (génériques / nominatives), RIEN n'est écrit ;
 *                                        texte complet + verdict R1–R7 dans
 *                                        evals/relances/etalonnage-<date>.md
 *   npm run relances:9 -- --appliquer    régénère EN PLACE les relances en attente
 *                                        ni validées, ni programmées, ni retouchées
 *   npm run relances:9 -- --appliquer --dry   (lecture seule : la liste visée)
 *
 * Jamais : une relance validée, programmée, retouchée à la main ou écrite hors
 * application ; ESPACE 3000 (hors cible, Axel l'écarte). Rien n'est envoyé ni supprimé.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import type { Prospect } from "@/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { composeFollowUp } = require("@/lib/outbox/follow-up") as typeof import("@/lib/outbox/follow-up");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isGenericAddress } = require("@/lib/contact-finder/upgrade") as typeof import("@/lib/contact-finder/upgrade");

const BUDGET_EUR = 0.55;
/** Hors cible (Axel l'écarte) ou déjà validées : jamais touchées, quoi qu'il arrive. */
const NEVER = /^(espace 3000|gatine|nordisk|caste ing|thibault bergeron|carea sanitaire|fonderie de la bruche)/i;
const table = db as never as { from: (t: string) => any };
type Draft = { id: string; prospect_id: string; type: "relance_1" | "relance_2"; subject: string | null; validated_at: string | null; scheduled_at: string | null; send_status: string | null; edited_by_hand: boolean | null; origin: string | null };

async function pendingRelances(userId: string): Promise<{ draft: Draft; prospect: Prospect }[]> {
  const { data } = await table
    .from("messages")
    .select("id, prospect_id, type, subject, validated_at, scheduled_at, send_status, edited_by_hand, origin")
    .eq("user_id", userId)
    .in("type", ["relance_1", "relance_2"])
    .eq("status", "draft")
    .is("deleted_at", null);
  const drafts = ((data ?? []) as Draft[]).filter(
    (draft) => !draft.validated_at && !draft.scheduled_at && (!draft.send_status || draft.send_status === "draft") && !draft.edited_by_hand && !draft.origin,
  );
  const out: { draft: Draft; prospect: Prospect }[] = [];
  for (const draft of drafts) {
    const { data: prospect } = await table.from("prospects").select("*").eq("id", draft.prospect_id).maybeSingle();
    if (prospect && !NEVER.test((prospect as Prospect).company_name)) out.push({ draft, prospect: prospect as Prospect });
  }
  return out;
}

const verdictLine = (items: { id: string; ok: boolean; citation: string }[] | undefined) =>
  (items ?? []).map((item) => `${item.id} ${item.ok ? "OUI" : "NON"}${item.ok ? "" : ` (${item.citation})`}`).join(" · ");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const apply = process.argv.includes("--appliquer");
  const dry = process.argv.includes("--dry");
  const pending = await pendingRelances(userId);

  if (apply) {
    console.log(`${pending.length} relance(s) en attente à régénérer : ${pending.map((item) => item.prospect.company_name).join(", ")}${dry ? " (lecture seule)" : ""}`);
    if (dry) return;
    let ready = 0;
    let review = 0;
    for (const { draft, prospect } of pending) {
      if ((await spentSince(userId, started)) > BUDGET_EUR) {
        console.log("Plafond de dépense atteint : arrêt.");
        break;
      }
      const composed = await composeFollowUp(table as never, { userId, prospect, type: draft.type, ask: liveAsk(prospect.id) });
      if (!composed.ok) {
        console.log(`  ${prospect.company_name} : ${composed.error}`);
        continue;
      }
      const { subject, body, quality_score, quality_reason, ready: ok } = composed.draft;
      // Mise à jour EN PLACE (même brouillon, même fil) : rien n'est supprimé.
      await table.from("messages").update({ subject, body, quality_score, quality_reason }).eq("id", draft.id).is("validated_at", null).eq("status", "draft");
      if (ok) ready += 1;
      else review += 1;
      console.log(`  ${prospect.company_name} : ${ok ? "PRÊTE" : `À revoir — ${quality_reason}`}`);
    }
    console.log(`\nPrêtes : ${ready} · à revoir : ${review} · coût ${(await spentSince(userId, started)).toFixed(4)} €`);
    return;
  }

  // Étalonnage : 8 prospects réels (relances en attente d'abord, puis autres contactés), génériques / nominatives.
  const candidates: Prospect[] = pending.map((item) => item.prospect);
  if (candidates.length < 12) {
    const { data } = await table.from("prospects").select("*").eq("user_id", userId).eq("status", "contacte").limit(60);
    for (const prospect of (data ?? []) as Prospect[]) if (!candidates.some((item) => item.id === prospect.id) && !NEVER.test(prospect.company_name)) candidates.push(prospect);
  }
  const generic = candidates.filter((prospect) => isGenericAddress({ email: prospect.email, email_type: prospect.email_type ?? null }));
  const nominative = candidates.filter((prospect) => !generic.includes(prospect));
  const lines: string[] = [`# Étalonnage des relances — ${started.slice(0, 10)}`, "", "8 relances générées sur des prospects réels, SANS écriture en base. Verdict R1–R7 du générateur ; note d'Axel / Cowork à ajouter.", ""];
  let done = 0;
  // Alternance générique / nominative, puis le reste de la liste la plus longue.
  const queue: (readonly ["générique" | "nominative", Prospect])[] = [];
  for (let index = 0; index < Math.max(generic.length, nominative.length); index += 1) {
    if (generic[index]) queue.push(["générique", generic[index]]);
    if (nominative[index]) queue.push(["nominative", nominative[index]]);
  }
  for (const [kind, prospect] of queue) {
    if (done >= 8) break;
    if ((await spentSince(userId, started)) > BUDGET_EUR) {
      lines.push("Plafond de dépense atteint : arrêt.");
      break;
    }
    const composed = await composeFollowUp(table as never, { userId, prospect, type: "relance_1", ask: liveAsk(prospect.id) });
    if (!composed.ok) continue;
    done += 1;
    const draft = composed.draft;
    lines.push(`## ${done}. ${prospect.company_name} — adresse ${kind}`, "", `Objet : ${draft.subject}`, "", "```", draft.body, "```", "", `Verdict : ${draft.ready ? "PRÊTE" : "À REVOIR"} · ${draft.quality_score ?? "?"}/10${draft.quality_reason ? ` · ${draft.quality_reason}` : ""}`, "", `Grille : ${verdictLine(draft.checklist)}`, "", "Note Axel / Cowork : …", "");
    console.log(`${done}. ${prospect.company_name} (${kind}) : ${draft.ready ? "PRÊTE" : `À revoir — ${draft.quality_reason}`}`);
  }
  lines.push(`Coût : ${(await spentSince(userId, started)).toFixed(4)} €`);
  mkdirSync("evals/relances", { recursive: true });
  const file = `evals/relances/etalonnage-${started.slice(0, 10)}.md`;
  writeFileSync(file, `${lines.join("\n")}\n`);
  console.log(`\n${file} · coût ${(await spentSince(userId, started)).toFixed(4)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
