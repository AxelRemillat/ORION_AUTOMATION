import { getOpenAI } from "@/lib/openai";
import { modelFor } from "@/lib/ai/models";
import { buildParams } from "@/lib/ai/params";
import { withParamFallback } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import type { AmbiguityJudge } from "./refusal-server";

/**
 * Juge LLM LÉGER des réponses ambiguës (Cowork #51) : modèle « extract »,
 * 300 caractères au plus, 5 jetons en sortie, coût tracé (`refus:tri`), bien
 * sous 0,001 € par mail. Dans le doute, il répond « autre » : rien ne change.
 */
const SYSTEM =
  "Tu lis le début d'une réponse à un mail de prospection B2B. Réponds en JSON {\"v\":\"refus\"} seulement si c'est un refus CLAIR " +
  "et définitif (pas intéressé, pas de besoin). Un report, une question, une demande d'information, une absence ou un doute : {\"v\":\"autre\"}.";

export function refusalJudge(prospectId: string | null): AmbiguityJudge {
  return async (text) => {
    if (!process.env.OPENAI_API_KEY) return null;
    const model = modelFor("extract");
    const completion = await withParamFallback(
      model,
      () => buildParams({ model, temperature: 0, maxOutputTokens: 12 }),
      (params) =>
        getOpenAI().chat.completions.create(
          {
            ...(params as { model: string }),
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: text.slice(0, 300) },
            ],
          },
          { timeout: 15_000, maxRetries: 0 },
        ),
    );
    if (completion.usage) {
      await recordOpenAiUsage({ model, promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens, operation: "refus:tri", prospectId }).catch(() => null);
    }
    const raw = completion.choices[0]?.message?.content ?? "";
    return /"v"\s*:\s*"refus"/.test(raw) ? "refus" : "autre";
  };
}
