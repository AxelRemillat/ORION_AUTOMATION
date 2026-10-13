/**
 * LOT DE RATTRAPAGE — vérification Hunter des adresses avant envoi (Cowork #26).
 * PAYANT : 0,5 crédit Hunter par vérification ; plafond dur 150 crédits (300 vérifications).
 *
 * Cibles : les mails PROGRAMMÉS (adresse `scheduled_to`) et les fiches PRÊTES (brouillon
 * d'intro ou de relance ≥ 9/10, ni envoyé ni programmé : adresse du prospect). Une adresse
 * déjà vérifiée il y a moins de 30 jours n'est pas repayée. Rien n'est envoyé, aucun mail
 * n'est touché : seul le cache de vérification (enrichment_cache) est écrit.
 *
 *   npx tsc -p tsconfig.test.json && node -r ./scripts/alias.cjs .test-build/scripts/verification-envoi.js --dry
 *   … sans --dry : vérifie, dans la limite de 150 crédits
 */
import { db, ownerId } from "./quality-live";
import { checkRecipient, CREDITS_PER_VERIFICATION, verifyKey } from "@/lib/outbox/recipient-check";
import { realRecipientDeps } from "@/lib/outbox/recipient-check-server";
import { readAll } from "@/lib/supabase/read-all";

const MAX_CREDITS = 150;
const dry = process.argv.includes("--dry");
type Table = { from: (table: string) => any };

async function main() {
  const userId = await ownerId();
  const table = db as never as Table;
  const scheduled = await readAll<{ scheduled_to: string | null }>(() =>
    table.from("messages").select("scheduled_to").eq("user_id", userId).in("send_status", ["scheduled", "sending"]).is("deleted_at", null).order("id"),
  );
  const ready = await readAll<{ prospect_id: string | null }>(() =>
    table.from("messages").select("prospect_id").eq("user_id", userId).eq("status", "draft").in("type", ["intro", "relance_1", "relance_2"]).gte("quality_score", 9).is("scheduled_at", null).is("deleted_at", null).order("id"),
  );
  const prospectIds = [...new Set(ready.map((row) => row.prospect_id).filter((id): id is string => Boolean(id)))];
  const prospects = prospectIds.length
    ? await readAll<{ email: string | null }>(() => table.from("prospects").select("email").in("id", prospectIds).is("deleted_at", null).order("id"))
    : [];
  const fromScheduled = scheduled.map((row) => row.scheduled_to).filter((email): email is string => Boolean(email));
  const fromReady = prospects.map((row) => row.email).filter((email): email is string => Boolean(email));
  const emails = [...new Set([...fromScheduled, ...fromReady].map((email) => email.trim().toLowerCase()))];

  const now = new Date();
  const deps = realRecipientDeps(table, now);
  const pending: string[] = [];
  for (const email of emails) if (!(await deps.read(verifyKey(email)).catch(() => null))) pending.push(email);
  const credits = pending.length * CREDITS_PER_VERIFICATION;
  console.log(`${fromScheduled.length} mail(s) programmé(s), ${fromReady.length} fiche(s) prête(s) → ${emails.length} adresse(s) distincte(s)`);
  console.log(`${emails.length - pending.length} déjà vérifiée(s) (< 30 j), ${pending.length} à vérifier → ${credits} crédit(s) Hunter (plafond ${MAX_CREDITS})`);
  if (dry) return process.exit(0);

  const counts: Record<string, number> = {};
  let spent = 0;
  const flagged: string[] = [];
  for (const email of emails) {
    const cachedBefore = pending.includes(email) ? null : true;
    if (!cachedBefore && spent + CREDITS_PER_VERIFICATION > MAX_CREDITS) {
      console.log("Plafond de 150 crédits atteint : arrêt.");
      break;
    }
    const check = await checkRecipient(email, deps);
    if (check.source === "hunter") spent += CREDITS_PER_VERIFICATION;
    counts[check.verdict] = (counts[check.verdict] ?? 0) + 1;
    if (check.verdict === "bloquee" || check.verdict === "risquee") flagged.push(`${check.verdict === "bloquee" ? "INVALIDE" : "risquée"} · ${email} · ${check.status}`);
  }
  console.log(`\nRésultat : ${JSON.stringify(counts)} · ${spent} crédit(s) dépensé(s)`);
  for (const line of flagged) console.log(`  ${line}`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
