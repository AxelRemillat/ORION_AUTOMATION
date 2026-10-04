/**
 * RÉGÉNÉRATION des brouillons d'intro NON validés de la file du jour
 * (« Nouveaux prospects » + « À compléter ») avec le gabarit qualité.
 *
 *   npm run regenerate:drafts -- --dry   aperçu, aucune écriture
 *   npm run regenerate:drafts            régénère (PAYANT, plafond 0,50 €)
 *   npm run regenerate:drafts -- --only "%SPI ENERGIE%"   une seule fiche (motif ILIKE)
 *
 * Règles : aucun envoi, aucune suppression. L'ancienne version de chaque
 * brouillon est rangée dans `message_versions` AVANT remplacement
 * (lib/emails/quality/versions.ts). Jamais un brouillon validé, programmé,
 * parti, ni retouché à la main. Les fiches « signal pour un client » sont
 * sautées (hors cible).
 */
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { offTargetReason } from "@/lib/funnel/off-target";
import { replaceDraft } from "@/lib/emails/quality/versions";
import { recordDraftVariant } from "@/lib/emails/quality/variant";
import { clichesOf } from "@/lib/emails/quality/rules";
import { hookOfBody, opensWithAvec } from "@/lib/emails/quality/readiness";
import type { Prospect } from "@/types";

const BUDGET_EUR = 0.5;
const dry = process.argv.includes("--dry");
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? (process.argv[onlyIndex + 1] ?? "").replace(/%/g, "").trim().toLowerCase() : null;

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const items = flatten((await loadToday(db as never, userId)).groups).filter(
    (item) =>
      (item.kind === "nouveau" || item.kind === "a_completer") &&
      item.messageType === "intro" &&
      item.messageId &&
      item.status === "todo" &&
      (!only || item.companyName.toLowerCase().includes(only)),
  );
  console.log(`${items.length} brouillon(s) d'intro non validés dans la file du jour${dry ? " (aperçu)" : ""}.`);
  const report = { regenerated: 0, shown: 0, review: 0, edited: 0, skipped: 0, errors: 0 };
  const usedCliches: string[] = [];
  const dayOpenings = { total: 0, avec: 0 };

  for (const item of items) {
    const spent = await spentSince(userId, started);
    if (spent > BUDGET_EUR - 0.05) {
      console.log(`Arrêt : ${spent.toFixed(3)} € dépensés, plafond ${BUDGET_EUR} €.`);
      break;
    }
    const { data: message } = await db.from("messages").select("*").eq("id", item.messageId!).maybeSingle();
    const row = message as { edited_by_hand?: boolean; validated_at?: string | null; status: string } | null;
    if (!row || row.status !== "draft" || row.validated_at) {
      report.skipped += 1;
      continue;
    }
    if (row.edited_by_hand) {
      report.edited += 1;
      console.log(`- ${item.companyName} : retouché à la main, gardé tel quel`);
      continue;
    }
    const { data } = await db.from("prospects").select("*").eq("id", item.prospectId!).maybeSingle();
    const prospect = data as Prospect | null;
    const excluded = prospect ? offTargetReason(prospect) : "fiche introuvable";
    if (!prospect || excluded?.startsWith("signal pour un client")) {
      report.skipped += 1;
      console.log(`- ${item.companyName} : sauté (${excluded})`);
      continue;
    }
    if (dry) {
      console.log(`- ${item.companyName} : serait régénéré`);
      continue;
    }
    // Recherche de site gratuite en amont, puis lecture du site : enregistrées (comme le job).
    const { outcome, civilities, brief } = await prepareMail(prospect, userId, { readSite: true, persist: true, usedCliches, dayOpenings });
    if ("blocked" in outcome) {
      // Pas de matière : le texte du brouillon ne change pas, mais il passe en
      // « À revoir » avec la raison (plus jamais affiché en « Nouveaux »).
      await db.from("prospects").update({ key_figures: { ...(prospect.key_figures ?? {}), mail_review: { reason: outcome.blocked, at: new Date().toISOString() } } }).eq("id", prospect.id);
      await db.from("messages").update({ quality_reason: outcome.blocked, quality_score: null }).eq("id", item.messageId!).eq("status", "draft").eq("edited_by_hand", false);
      report.review += 1;
      console.log(`- ${item.companyName} : À revoir, aucun nouveau mail — ${outcome.blocked}`);
      continue;
    }
    if ("error" in outcome) {
      report.errors += 1;
      console.log(`- ${item.companyName} : erreur — ${outcome.error} (brouillon inchangé)`);
      continue;
    }
    const saved = await replaceDraft(
      { db: db as never, userId },
      item.messageId!,
      { subject: outcome.subject, body: outcome.body, quality_score: outcome.score, quality_reason: outcome.needsReview ? outcome.reviewReason : null },
      { auto: true, reason: "régénération gabarit qualité (03/10/2026)" },
    );
    if (saved !== "edited") await recordDraftVariant(db, { messageId: item.messageId!, userId, brief, outcome });
    // Civilités résolues : gardées sur la fiche, la question ne se repose pas.
    if (Object.keys(civilities).length) {
      await db.from("prospects").update({ key_figures: { ...(prospect.key_figures ?? {}), civilites: civilities } }).eq("id", prospect.id);
    }
    if (saved === "edited") report.edited += 1;
    else {
      report.regenerated += 1;
      if (outcome.needsReview) report.review += 1;
      else {
        report.shown += 1;
        usedCliches.push(...clichesOf(outcome.body));
        dayOpenings.total += 1;
        if (opensWithAvec(hookOfBody(outcome.body))) dayOpenings.avec += 1;
      }
    }
    console.log(`- ${item.companyName} : ${outcome.score ?? "?"}/10${outcome.needsReview ? ` → À revoir (${outcome.reviewReason})` : ""}`);
  }

  const spent = await spentSince(userId, started);
  console.log(`\n${JSON.stringify(report)} · coût OpenAI ${spent.toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
