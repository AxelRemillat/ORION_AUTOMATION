/**
 * APPEL DE TEST OpenAI (Cowork #35) — une complétion minuscule (≈ 20 jetons,
 * coût négligeable) à travers le point d'appel commun : le garde-fou met à jour
 * l'état partagé du crédit (bandeaux) et notifie « épuisé » / « rétabli ».
 *
 *   npm run openai:ping
 *
 * Sortie : « OK » si le crédit est disponible, « QUOTA » s'il est épuisé.
 */
import "./quality-live";
import { chatJson } from "@/lib/ai/chat";
import { isOpenAIQuotaError } from "@/lib/ai/quota";
import { getOpenAI } from "@/lib/openai";

async function main() {
  try {
    await chatJson({ client: getOpenAI(), role: "profile", system: 'Réponds en JSON : {"ok":true}.', user: "ping", temperature: 0, maxOutputTokens: 20, operation: "ping" });
    console.log("OK : crédit OpenAI disponible");
  } catch (error) {
    if (isOpenAIQuotaError(error)) {
      console.log("QUOTA : crédit OpenAI épuisé");
      process.exit(2);
    }
    console.log(`ERREUR : ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
    process.exit(1);
  }
}

void main();
