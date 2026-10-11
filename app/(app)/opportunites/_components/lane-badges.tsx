import type { Opportunity } from "@/lib/opportunities/types";
import { isUrgent, LAUNCH_BADGE, offersCount } from "@/lib/opportunities/lane";
import { rowLane } from "@/lib/opportunities/view";

/** Repères Codeur (11/10/2026) : « Lancement », « Urgent » (moins de 2 h), offres déjà déposées si connues. */
export function LaneBadges({ item }: { item: Opportunity }) {
  const lane = item.filter_reason ? null : rowLane(item);
  const urgent = lane === "lancement" && isUrgent(item.published_at);
  const offers = offersCount(item.body);
  return (
    <>
      {lane === "lancement" && (
        <span title="Mission de lancement : développement web, petit budget — répondre parmi les premiers" className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary-ink">
          {LAUNCH_BADGE}
        </span>
      )}
      {urgent && <span className="shrink-0 rounded-full border border-lost/30 bg-lost/10 px-2 py-0.5 text-[11px] text-lost-ink">Urgent</span>}
      {lane === "cms_impose" && <span className="shrink-0 rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn-ink">CMS imposé</span>}
      {offers !== null && <span className="shrink-0 font-data text-[11px] text-muted">{offers} offre{offers > 1 ? "s" : ""}</span>}
    </>
  );
}
