/**
 * REJUGEMENT DU STOCK (Cowork #36) avec la check-list en vigueur : les
 * brouillons d'intro de « Nouveaux » et ceux en « Contact à vérifier ».
 *
 *   npm run rejudge:drafts -- --dry   verdicts seulement (PAYANT, ~0,002 € par brouillon)
 *   npm run rejudge:drafts            + UNE régénération (job de production) pour chaque échec
 *
 * Un brouillon validé, programmé ou retouché à la main n'est jamais touché ;
 * une fiche « ne plus contacter », opposée ou perdue non plus. Une régénération
 * qui échoue encore passe en « À revoir » (le job pose la raison). Aucun envoi.
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { scriptJobSource } from "@/lib/jobs/regen-cap";
import { createJob } from "@/lib/jobs/store";
import { emailBlocker } from "@/lib/jobs/handlers/email";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { judgeChecklist } from "@/lib/emails/quality/checklist";
import { isFamily, type MailFamily } from "@/lib/emails/quality/families";
import { keyFactsOf } from "@/lib/emails/quality/facts-gate";
import { buildFacts } from "@/lib/emails/derived-facts";
import { storedProfile } from "@/lib/emails/business-profile";
import type { Prospect } from "@/types";

const dry = process.argv.includes("--dry");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const loose = db as never as { from: (table: string) => any };
  const items = flatten((await loadToday(db as never, userId)).groups).filter(
    (item) => item.messageType === "intro" && item.messageId && item.status === "todo" && (item.kind === "nouveau" || item.tags.includes("Contact à vérifier")),
  );
  console.log(`${items.length} brouillon(s) à rejuger${dry ? " (sans régénération)" : ""}.`);
  const tally = { ready: 0, regenerated: 0, skipped: 0 };
  for (const item of items) {
    const { data: message } = await loose.from("messages").select("id, subject, body, status, validated_at, scheduled_at, edited_by_hand").eq("id", item.messageId).maybeSingle();
    if (!message || message.status !== "draft" || message.validated_at || message.scheduled_at || message.edited_by_hand) {
      tally.skipped += 1;
      console.log(`- ${item.companyName} : verrouillé (validé, programmé ou retouché), non touché`);
      continue;
    }
    const { data } = await loose.from("prospects").select("*").eq("id", item.prospectId).maybeSingle();
    const prospect = data as Prospect | null;
    const blocker = prospect ? emailBlocker(prospect) : { message: "fiche introuvable", status: 404 };
    if (!prospect || (blocker && blocker.status === 409)) {
      tally.skipped += 1;
      console.log(`- ${item.companyName} : ${blocker?.message ?? "fiche introuvable"}`);
      continue;
    }
    const { data: variant } = await loose.from("message_variants").select("family").eq("message_id", message.id).maybeSingle();
    const family: MailFamily = isFamily(variant?.family) ? variant.family : "F1";
    const core = String(message.body).replace(/\r\n/g, "\n").split("\n\nSi le sujet")[0].trim();
    const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
    const profile = storedProfile(prospect.business_profile);
    const facts = [
      ...(keyFactsOf(figures) ?? []).map((fact) => `- Fait vérifié (${fact.distinctiveness}/3) : ${fact.text}`),
      ...buildFacts(prospect, null).facts.map((fact) => `- ${fact.label} : ${fact.value}`),
      profile?.offer ? `- Activité (leur site) : ${profile.offer}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const siteText = [JSON.stringify(prospect.business_profile ?? {}), prospect.website ?? "", ...(prospect.signals ?? []).map((signal) => signal.label)].join(" ");
    const verdict = await judgeChecklist(
      liveAsk(prospect.id),
      { subject: message.subject ?? "", core, family, greeting: core.split("\n\n")[0] ?? "", company: prospect.company_name, facts, recipientRole: prospect.contact_role ?? null, siteText },
      "qualite:rejugement",
    );
    if (verdict?.ready) {
      tally.ready += 1;
      console.log(`- ${item.companyName} (${family}) : PRÊT`);
      continue;
    }
    const failed = verdict ? verdict.items.filter((criterion) => !criterion.ok).map((criterion) => criterion.id).join("+") : "relecture indisponible";
    if (dry) {
      console.log(`- ${item.companyName} (${family}) : NON (${failed})`);
      continue;
    }
    const created = await createJob(
      db as never,
      { type: "email_generate", target: { prospectId: prospect.id, label: `Mail ${item.companyName}` }, params: { prospectId: prospect.id, mode: "full", saveDraft: true, storedContact: true, auto: true, ...scriptJobSource() } },
      userId,
    );
    tally.regenerated += 1;
    console.log(`- ${item.companyName} (${family}) : NON (${failed}) → ${"id" in created ? "une régénération lancée" : `non lancée (${created.error})`}`);
  }
  console.log(`\n${JSON.stringify(tally)} · coût du rejugement ${(await spentSince(userId, started)).toFixed(3)} €`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
