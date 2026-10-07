/**
 * ÉTALONNAGE DE LA CHECK-LIST sur le jeu D (Cowork #34) : les 15 mails notés à
 * la main par Cowork (lib/emails/quality/cowork-d-set.ts). PAYANT (~0,10 €).
 *
 *   npm run calibrate:judge
 *
 * Pour chaque mail : la check-list réelle (code + modèle, mêmes faits et même
 * texte du site qu'en production), puis l'accord avec le verdict humain
 * (« prêt » = 9 ou plus). Cible : au moins 13 accords sur 15. Rien n'est écrit.
 */
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import { COWORK_D_SET, COWORK_SET_2, F4_GUARDS } from "@/lib/emails/quality/cowork-d-set";
import { judgeChecklist } from "@/lib/emails/quality/checklist";
import { keyFactsOf } from "@/lib/emails/quality/facts-gate";
import { buildFacts } from "@/lib/emails/derived-facts";
import { storedProfile } from "@/lib/emails/business-profile";
import type { Prospect } from "@/types";

/** Cible Cowork #36 : 22 accords sur 25 (88 %), rapportée au nombre de mails jugés. */
const TARGET_RATE = 22 / 25;

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const loose = db as never as { from: (table: string) => any };
  let agree = 0;
  const guards: string[] = [];
  const rows: string[] = [];
  let judged = 0;
  for (const mail of [...COWORK_D_SET, ...COWORK_SET_2, ...F4_GUARDS]) {
    const guard = "expectFail" in mail ? (mail as { expectFail: string }).expectFail : null;
    const name = mail.company.replace(/\s*\(.*$/, "").slice(0, 30);
    const { data } = await loose.from("prospects").select("*").eq("user_id", userId).ilike("company_name", `%${name}%`).is("deleted_at", null).limit(1);
    const prospect = (data ?? [])[0] as Prospect | undefined;
    // « Ne plus contacter » (Cowork #36, CAMEL DIAM) : exclue de toute génération ET de l'étalonnage.
    if (prospect?.do_not_contact) {
      rows.push(`| ${mail.company} | ${mail.family} | — | — | exclue (ne plus contacter) | — |`);
      continue;
    }
    if (!guard) judged += 1;
    const figures = (prospect?.key_figures ?? {}) as Record<string, unknown>;
    const keyFacts = keyFactsOf(figures) ?? [];
    const derived = prospect ? buildFacts(prospect, null).facts : [];
    const profile = prospect ? storedProfile(prospect.business_profile) : null;
    const facts = [
      ...keyFacts.map((fact) => `- Fait vérifié (${fact.distinctiveness}/3) : ${fact.text}`),
      ...derived.map((fact) => `- ${fact.label} : ${fact.value}`),
      profile?.offer ? `- Activité (leur site) : ${profile.offer}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const siteText = prospect ? [JSON.stringify(prospect.business_profile ?? {}), prospect.website ?? "", ...(prospect.signals ?? []).map((signal) => signal.label)].join(" ") : "";
    const verdict = await judgeChecklist(
      liveAsk(prospect?.id ?? null),
      { subject: mail.subject, core: mail.core, family: mail.family, greeting: mail.core.split("\n\n")[0] ?? "", company: prospect?.company_name ?? mail.company, facts, recipientRole: prospect?.contact_role ?? null, siteText },
      "qualite:etalonnage",
    );
    const ready = Boolean(verdict?.ready);
    // Garde-fou F4 (Cowork #35) : refus attendu sur un critère précis, compté à part.
    const ok = verdict !== null && ready === mail.coworkReady && (!guard || verdict.items.some((item) => item.id === guard && !item.ok));
    if (ok && !guard) agree += 1;
    if (guard) guards.push(`${mail.company} : ${ok ? `refusé sur ${guard} comme attendu` : `ÉCART (attendu ${guard} NON)`}`);
    const failed = verdict?.items.filter((item) => !item.ok).map((item) => `${item.id} « ${item.citation.slice(0, 70)} »`).join(" ; ") ?? "relecture indisponible";
    rows.push(`| ${mail.company} | ${mail.family} | ${mail.coworkReady ? "prêt" : `non (${mail.coworkScore})`} | ${ready ? "prêt" : "non"} | ${ok ? "accord" : "**ÉCART**"} | ${failed || "—"} |`);
  }
  console.log("| Mail | Famille | Cowork | Check-list | Accord | Critères à NON |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  console.log(rows.join("\n"));
  console.log(`\nGarde-fous F4 : ${guards.join(" · ")}`);
  const target = Math.ceil(TARGET_RATE * judged);
  console.log(`\nAccords avec Cowork : ${agree}/${judged} (cible ${target}) · coût ${(await spentSince(userId, started)).toFixed(3)} €`);
  if (agree < target) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
