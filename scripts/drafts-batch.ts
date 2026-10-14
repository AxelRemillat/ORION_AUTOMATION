/**
 * BROUILLONS DU LENDEMAIN, LANCEMENT MANUEL (Cowork #35) — pour chaque fiche
 * prête sans brouillon (`needsIntroDraft`, la règle de la préparation), un job
 * `email_generate` identique à celui de la préparation de production, exécuté
 * par le tick des jobs (jamais le cron de 5 h, qui reste coupé).
 *
 *   npm run drafts:lot -- --dry      liste des fiches, rien n'est lancé
 *   npm run drafts:lot               lance les jobs
 *   npm run drafts:lot -- --status   brouillons prêts (« Nouveaux ») par famille, à revoir, en cours
 *   npm run drafts:lot -- --reprise "essai score 3 (Cowork #27)"   seulement les fiches de cette reprise
 *
 * Seuls les mails « prêts » (check-list à OUI) entrent dans « Nouveaux » ; les
 * autres passent en « À revoir ». Jamais un brouillon validé, programmé ou
 * retouché à la main (le job ne les réécrit pas). Aucun envoi.
 */
import { db, ownerId } from "./quality-live";
import { scriptJobSource } from "@/lib/jobs/regen-cap";
import { createJob } from "@/lib/jobs/store";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { needsIntroDraft } from "@/lib/today/tags";

async function status(userId: string) {
  const items = flatten((await loadToday(db as never, userId)).groups).filter((item) => item.messageType === "intro");
  const ready = items.filter((item) => item.kind === "nouveau" && item.status === "todo" && item.messageId);
  const ids = ready.map((item) => item.messageId!);
  const { data } = ids.length ? await (db as never as { from: (table: string) => any }).from("message_variants").select("message_id, family").in("message_id", ids) : { data: [] };
  const familyOf = new Map(((data ?? []) as { message_id: string; family: string | null }[]).map((row) => [row.message_id, row.family ?? "?"]));
  const byFamily: Record<string, number> = {};
  for (const item of ready) byFamily[familyOf.get(item.messageId!) ?? "?"] = (byFamily[familyOf.get(item.messageId!) ?? "?"] ?? 0) + 1;
  const review = items.filter((item) => item.tags.includes("À revoir")).length;
  const facts = items.filter((item) => item.tags.includes("Faits insuffisants")).length;
  const pending = items.filter((item) => item.draftPending).length;
  console.log(`Prêts dans « Nouveaux » : ${ready.length} ${JSON.stringify(byFamily)} · à revoir : ${review} · faits insuffisants : ${facts} · en cours : ${pending}`);
}

async function main() {
  const userId = await ownerId();
  if (process.argv.includes("--status")) return status(userId);
  const all = flatten((await loadToday(db as never, userId)).groups).filter(needsIntroDraft);
  // Lot restreint à une reprise tracée (`contact.reprise`, Cowork #28) : le reste attend la préparation.
  const reprise = process.argv.indexOf("--reprise") >= 0 ? process.argv[process.argv.indexOf("--reprise") + 1] : null;
  const scope = reprise
    ? new Set((((await (db as never as { from: (table: string) => any }).from("signal_candidates").select("prospect_id").eq("user_id", userId).eq("contact->>reprise", reprise)).data ?? []) as { prospect_id: string | null }[]).map((row) => row.prospect_id))
    : null;
  const items = scope ? all.filter((item) => scope.has(item.prospectId ?? null)) : all;
  console.log(`${items.length} fiche(s) prête(s) sans brouillon${process.argv.includes("--dry") ? " (aperçu)" : ""}.`);
  for (const item of items) {
    if (process.argv.includes("--dry")) {
      console.log(`- ${item.companyName}`);
      continue;
    }
    const created = await createJob(
      db as never,
      {
        type: "email_generate",
        target: { prospectId: item.prospectId!, label: `Mail ${item.companyName}` },
        params: { prospectId: item.prospectId!, mode: "full", saveDraft: true, storedContact: true, auto: true, ...scriptJobSource() },
      },
      userId,
    );
    console.log(`- ${item.companyName} : ${"id" in created ? "job lancé" : `non lancé (${created.error})`}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
