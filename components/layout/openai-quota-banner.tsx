import Link from "next/link";
import { readOpenAiQuotaState } from "@/lib/ai/quota-watch";
import { formatParisDateTime } from "@/lib/outbox/paris-time";

/**
 * Bandeau rouge « crédit OpenAI épuisé » (Cowork #35) : affiché tant que le
 * dernier appel OpenAI a échoué pour quota (état partagé, lib/ai/quota-watch.ts).
 * Disparaît au premier appel réussi. Composant serveur.
 */
export async function OpenAiQuotaBanner({ withLink = true }: { withLink?: boolean }) {
  const state = await readOpenAiQuotaState();
  if (!state?.failing) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-lost/25 bg-lost/10 px-4 py-3 text-[13px] text-lost-ink">
      <span>
        <strong>Crédit OpenAI épuisé</strong>
        {state.since ? ` depuis le ${formatParisDateTime(state.since)}` : ""} — rédaction, préparation et analyse des offres Codeur en pause.
        Recharge le compte OpenAI : tout reprend au premier appel réussi.
      </span>
      {withLink && (
        <Link href="/reglages/couts" className="font-medium underline-offset-2 hover:underline">
          Voir les coûts
        </Link>
      )}
    </div>
  );
}
