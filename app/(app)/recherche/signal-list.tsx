import {
  Building2,
  Cpu,
  Headphones,
  Newspaper,
  ShoppingCart,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ProspectSignal } from "@/types";

/**
 * Rendu des signaux d'une entreprise.
 * Chaque signal est déjà formulé côté opportunité par lib/enrichment/signals ;
 * on se contente ici de le typer visuellement.
 */

const ICONS: Record<string, LucideIcon> = {
  levee: TrendingUp,
  support: Headphones,
  recrutement: Users,
  ecommerce: ShoppingCart,
  croissance: TrendingUp,
  digital: Cpu,
  presse: Newspaper,
  structure: Building2,
};

/** Les signaux issus du web sont plus vendeurs que les signaux structurels. */
const HIGHLIGHTED = new Set(["levee", "support", "recrutement", "ecommerce"]);

export function SignalList({ signals, max = 4 }: { signals: ProspectSignal[]; max?: number }) {
  if (!signals.length) {
    return <p className="text-[13px] text-muted">Aucun signal détecté.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {signals.slice(0, max).map((signal, index) => {
        const Icon = ICONS[signal.type ?? "presse"] ?? Newspaper;
        const strong = HIGHLIGHTED.has(signal.type ?? "");
        return (
          <li key={`${signal.label}-${index}`} className="flex items-start gap-2">
            <Icon
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${strong ? "text-accent" : "text-muted"}`}
              aria-hidden
            />
            <span className="text-[13px] leading-snug text-fg">
              {signal.label}
              {signal.url && (
                <a
                  href={signal.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-1.5 text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
                >
                  source
                </a>
              )}
            </span>
          </li>
        );
      })}
      {signals.length > max && (
        <li className="text-xs text-muted">+ {signals.length - max} autre(s) signal(aux)</li>
      )}
    </ul>
  );
}
