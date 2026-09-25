import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui";

/**
 * Rappel affiché tant que « Mon offre » n'est pas remplie.
 *
 * Sans elle, les mails ne disent ni qui écrit, ni ce qui est proposé — le
 * défaut exact constaté en production. Le bandeau nomme la conséquence plutôt
 * que de se contenter d'un « à compléter ».
 */
export function OfferBanner() {
  return (
    <Card className="border-warn/30 bg-warn/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="flex items-start gap-2.5 text-[13px] text-text">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
          Complète ton offre pour des mails personnalisés : sans elle, ils ne disent ni qui écrit,
          ni ce que tu proposes.
        </span>
        <Link
          href="/offre"
          className="text-[13px] underline decoration-dotted underline-offset-2"
          style={{ color: "var(--primary-ink)" }}
        >
          Compléter mon offre
        </Link>
      </CardContent>
    </Card>
  );
}
