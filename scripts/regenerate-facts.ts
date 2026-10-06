/**
 * RÉGÉNÉRATION APRÈS LA PORTE « FAITS » (Cowork #31) — chaîne actuelle :
 * porte faits, rédacteur ancré sur le meilleur fait, double juge (relecteur
 * senior en médiane de 3), quota « Avec » tenu sur la série.
 *
 *   npm run regenerate:facts -- --dry          aperçu : cibles, porte, aucun appel payant
 *   npm run regenerate:facts                   régénère (PAYANT, plafond 1,00 €)
 *   npm run regenerate:facts -- --max-eur 0.6  autre plafond
 *
 * Cibles : les brouillons d'intro LIBRES (jamais validés, programmés, partis,
 * ni retouchés à la main) qui portent le marqueur d'agent1
 * (`messages.regenerate_reason`) ou qui sont dans « Nouveaux prospects ».
 * Fiche sans fait distinctif (key_figures.facts, distinctivité < 2) : aucun
 * appel, le brouillon passe en « Faits insuffisants » (texte inchangé). Fiche
 * sans champ `facts` : régénérée comme avant. L'ancienne version de chaque
 * brouillon est rangée dans `message_versions`. Aucun envoi, aucune suppression.
 */
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { offTargetReason } from "@/lib/funnel/off-target";
import { replaceDraft } from "@/lib/emails/quality/versions";
import { recordDraftVariant } from "@/lib/emails/quality/variant";
import { clichesOf } from "@/lib/emails/quality/rules";
import { hookOfBody, opensWithAvec } from "@/lib/emails/quality/readiness";
import { factsGate } from "@/lib/emails/quality/facts-gate";
import type { Prospect } from "@/types";

const dry = process.argv.includes("--dry");
const maxIndex = process.argv.indexOf("--max-eur");
const BUDGET_EUR = maxIndex >= 0 ? Number(process.argv[maxIndex + 1]) || 1 : 1;

interface DraftRow {
  id: string;
  prospect_id: string;
  type: string;
  status: string;
  validated_at: string | null;
  scheduled_at: string | null;
  edited_by_hand: boolean | null;
  deleted_at: string | null;
  regenerate_reason?: string | null;
}

const isFree = (row: DraftRow) => row.type === "intro" && row.status === "draft" && !row.validated_at && !row.scheduled_at && !row.edited_by_hand && !row.deleted_at;

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const loose = db as never as { from: (table: string) => any };

  // 1. Marqueur d'agent1 (colonne absente → aucune cible de ce côté).
  const marked = await loose.from("messages").select("id, prospect_id, type, status, validated_at, scheduled_at, edited_by_hand, deleted_at, regenerate_reason").eq("user_id", userId).not("regenerate_reason", "is", null);
  const markedRows = ((marked.error ? [] : marked.data) ?? []) as DraftRow[];
  // 2. « Nouveaux prospects » du jour.
  const items = flatten((await loadToday(db as never, userId)).groups).filter((item) => item.kind === "nouveau" && item.messageType === "intro" && item.messageId && item.status === "todo");
  const ids = [...new Set([...markedRows.map((row) => row.id), ...items.map((item) => item.messageId!)])];
  const { data: rows } = ids.length
    ? await loose.from("messages").select("id, prospect_id, type, status, validated_at, scheduled_at, edited_by_hand, deleted_at, regenerate_reason").in("id", ids)
    : { data: [] };
  const targets = ((rows ?? []) as DraftRow[]).filter(isFree);
  console.log(`${targets.length} brouillon(s) libres à régénérer (${markedRows.length} marqués par agent1, ${items.length} dans « Nouveaux »)${dry ? " — aperçu" : ""}.`);

  const report = { regenerated: 0, ready: 0, review: 0, factsInsufficient: 0, legacy: 0, skipped: 0, errors: 0 };
  const usedCliches: string[] = [];
  const dayOpenings = { total: 0, avec: 0 };
  const examples: string[] = [];

  for (const row of targets) {
    const spent = await spentSince(userId, started);
    if (spent > BUDGET_EUR - 0.06) {
      console.log(`Arrêt : ${spent.toFixed(3)} € dépensés, plafond ${BUDGET_EUR} €.`);
      break;
    }
    const { data } = await loose.from("prospects").select("*").eq("id", row.prospect_id).maybeSingle();
    const prospect = data as Prospect | null;
    const excluded = prospect ? offTargetReason(prospect) : "fiche introuvable";
    if (!prospect || excluded?.startsWith("signal pour un client")) {
      report.skipped += 1;
      continue;
    }
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const gate = factsGate(figures);
    if (!gate.ok) {
      report.factsInsufficient += 1;
      console.log(`- ${prospect.company_name} : Faits insuffisants (aucun appel)`);
      if (!dry) {
        await loose.from("prospects").update({ key_figures: { ...figures, mail_review: { reason: gate.reason, at: new Date().toISOString() } } }).eq("id", prospect.id);
        await loose.from("messages").update({ quality_reason: gate.reason, quality_score: null }).eq("id", row.id).eq("status", "draft").eq("edited_by_hand", false).is("validated_at", null).is("scheduled_at", null);
      }
      continue;
    }
    if (gate.facts === null) report.legacy += 1;
    if (dry) {
      console.log(`- ${prospect.company_name} : serait régénéré${gate.facts ? ` (meilleur fait ${gate.facts[0]?.distinctiveness}/3)` : " (fiche sans faits : chaîne d'avant)"}`);
      continue;
    }
    const { outcome, civilities, brief } = await prepareMail(prospect, userId, { usedCliches, dayOpenings });
    if ("blocked" in outcome || "error" in outcome) {
      report.errors += 1;
      console.log(`- ${prospect.company_name} : ${"blocked" in outcome ? `bloqué — ${outcome.blocked}` : `erreur — ${outcome.error}`} (brouillon inchangé)`);
      continue;
    }
    const saved = await replaceDraft(
      { db: db as never, userId },
      row.id,
      { subject: outcome.subject, body: outcome.body, quality_score: outcome.score, quality_reason: outcome.needsReview ? outcome.reviewReason : null },
      { auto: true, reason: "régénération porte faits + double juge (Cowork #31)" },
    );
    if (saved === "locked" || saved === "edited") {
      report.skipped += 1;
      continue;
    }
    // Régénéré : le marqueur d'agent1 tombe.
    if (row.regenerate_reason) await loose.from("messages").update({ regenerate_reason: null }).eq("id", row.id).eq("status", "draft");
    await recordDraftVariant(db, { messageId: row.id, userId, brief, outcome });
    if (Object.keys(civilities).length) await loose.from("prospects").update({ key_figures: { ...figures, civilites: civilities } }).eq("id", prospect.id);
    report.regenerated += 1;
    if (outcome.needsReview) report.review += 1;
    else {
      report.ready += 1;
      usedCliches.push(...clichesOf(outcome.body));
      dayOpenings.total += 1;
      if (opensWithAvec(hookOfBody(outcome.body))) dayOpenings.avec += 1;
      if (examples.length < 3) examples.push(`${prospect.company_name} — fait : ${gate.facts?.[0]?.text ?? "(fiche sans faits)"}\n${outcome.body.split("\n\nSi le sujet")[0]}`);
    }
    console.log(`- ${prospect.company_name} : ${outcome.score ?? "?"}/10${outcome.needsReview ? ` → À revoir (${outcome.reviewReason})` : " → PRÊT"}`);
  }

  const spent = await spentSince(userId, started);
  const gated = report.regenerated;
  console.log(`\n${JSON.stringify(report)} · prêts ${report.ready}/${gated} (${gated ? Math.round((100 * report.ready) / gated) : 0} %) · coût ${spent.toFixed(3)} €`);
  if (examples.length) console.log(`\nExemples prêts :\n\n${examples.join("\n\n---\n\n")}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
