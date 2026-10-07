/**
 * ESSAI RÉEL des relances suggérées (PAYANT, quelques millièmes d'euro) :
 * 2 cas fictifs (Codeur, Upwork). Rien n'est écrit en base hors la
 * comptabilité des appels ; rien n'est envoyé.
 *
 *   npm run eval:relances
 */
import { liveAsk, ownerId, spentSince } from "./quality-live";
import { followUpFailures, generateFollowUp } from "@/lib/opportunities/follow-up";

const CASES = [
  { platform: "codeur" as const, language: "fr" as const, title: "Automatiser le tri de nos e-mails de commande", need: "Trier automatiquement environ 80 e-mails de commande par jour et les saisir dans le tableur de suivi.", proposal: "Bonjour,\n\nVous recevez 80 e-mails de commande par jour à recopier…\n\nPrix : 600 €. Délai : 10 jours.\n\nAxel Remillat" },
  { platform: "upwork" as const, language: "en" as const, title: "Simple AI lead qualification workflow in n8n", need: "Score Typeform leads with OpenAI and send hot ones to Slack.", proposal: "Your 150 monthly Typeform leads can be scored in n8n…\n\nFixed price: $800. Delivery: 10 days.\n\nAxel Remillat · AI & automation for small businesses" },
];

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  for (const item of CASES) {
    const outcome = await generateFollowUp(liveAsk(null), item);
    const failures = followUpFailures(outcome.text, item.platform);
    console.log(`\n=== ${item.platform} · ${outcome.source} · ${outcome.text.length} car.${failures.length ? ` · REFUS : ${failures.join(" ")}` : ""}\n${outcome.text}`);
  }
  console.log(`\nCoût : ${(await spentSince(userId, started)).toFixed(4)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
