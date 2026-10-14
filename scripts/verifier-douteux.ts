/**
 * « EMAIL NON VÉRIFIÉ » (Cowork #35) — vérification Hunter des adresses douteuses de la file
 * « À compléter » : 0,5 crédit l'adresse, résultat gardé 30 jours (verif-envoi:…, partagé avec
 * la vérification avant envoi). Plafond de crédits ; SIMULATION par défaut.
 *
 *   … verifier-douteux.js                  liste, rien n'est appelé
 *   … verifier-douteux.js --verifier       appelle Hunter (cache 30 j), affiche les verdicts
 *   … verifier-douteux.js --appliquer      + « valid » : le drapeau « douteux » est levé
 *     (`signal_candidates.contact.doubtful`, `key_figures.email_doubtful`) ; « invalid » :
 *     rien n'est effacé, la fiche reste bloquée avec le motif ; le reste reste « à vérifier ».
 */
import { db, ownerId } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { checkRecipient, CREDITS_PER_VERIFICATION } from "@/lib/outbox/recipient-check";
import { realRecipientDeps } from "@/lib/outbox/recipient-check-server";

const CAP_CREDITS = 10;
const verify = process.argv.includes("--verifier") || process.argv.includes("--appliquer");
const apply = process.argv.includes("--appliquer");

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  const items = flatten((await loadToday(db as never, userId)).groups).filter((item) => item.kind === "a_completer" && item.tags.includes("Email non vérifié") && item.contact.email);
  console.log(`${items.length} adresse(s) « non vérifiée(s) » · plafond ${CAP_CREDITS} crédits${verify ? "" : " — SIMULATION, aucun appel"}`);
  let credits = 0;
  for (const item of items) {
    const email = item.contact.email!;
    if (!verify) {
      console.log(`· ${item.companyName} | ${email}`);
      continue;
    }
    if (credits + CREDITS_PER_VERIFICATION > CAP_CREDITS) {
      console.log(`· ${item.companyName} | ${email} | plafond atteint, non vérifiée`);
      continue;
    }
    const check = await checkRecipient(email, realRecipientDeps(db as never));
    if (check.source === "hunter") credits += CREDITS_PER_VERIFICATION;
    let applied = "";
    if (apply && check.status === "valid" && item.prospectId) {
      const { data: candidate } = await table.from("signal_candidates").select("id, contact").eq("prospect_id", item.prospectId).limit(1).maybeSingle();
      if (candidate) await table.from("signal_candidates").update({ contact: { ...(candidate.contact ?? {}), doubtful: false, verified: { status: "valid", at: new Date().toISOString() } } }).eq("id", candidate.id);
      const { data: prospect } = await table.from("prospects").select("key_figures").eq("id", item.prospectId).maybeSingle();
      if (prospect) await table.from("prospects").update({ key_figures: { ...(prospect.key_figures ?? {}), email_doubtful: false } }).eq("id", item.prospectId);
      applied = " → drapeau levé";
    }
    console.log(`· ${item.companyName} | ${email} | ${check.status ?? "sans réponse"} (${check.source})${applied}`);
  }
  if (verify) console.log(`\nCrédits Hunter estimés : ${credits}`);
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
