import { cn } from "@/lib/utils";
import { TAB_LABELS, type PlatformTab } from "@/lib/opportunities/tabs";
import { PLATFORM_IDENTITIES } from "@/lib/opportunities/platform-style";
import { PLATFORM_ICONS } from "./platform-banner";

/** Onglets de page par plateforme, chacun avec ses alertes non vues. */
export function PlatformTabs({ tabs, active, badges, onSelect }: { tabs: PlatformTab[]; active: PlatformTab; badges: Record<PlatformTab, number>; onSelect: (tab: PlatformTab) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line scrollbar-none" role="tablist" aria-label="Plateformes">
      {tabs.map((tab) => {
        const Icon = PLATFORM_ICONS[tab];
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            onClick={() => onSelect(tab)}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[14px]",
              PLATFORM_IDENTITIES[tab].theme,
              active === tab ? "pf-tab-active font-medium" : "border-transparent text-muted hover:text-text",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {TAB_LABELS[tab]}
            {badges[tab] > 0 && (
              <span className="rounded-full bg-good/15 px-1.5 font-data text-[11px] text-good-ink" aria-label={`${badges[tab]} alerte(s) non vue(s)`}>
                {badges[tab]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
