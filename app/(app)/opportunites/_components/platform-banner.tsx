import { Globe, NotebookPen, Tag, Layers } from "lucide-react";
import { PLATFORM_IDENTITIES } from "@/lib/opportunities/platform-style";
import type { PlatformTab } from "@/lib/opportunities/tabs";
import { WorldClock } from "./world-clock";

export const PLATFORM_ICONS = { codeur: NotebookPen, upwork: Globe, comeup: Tag, autres: Layers } as const;

/** Bandeau d'en-tête de l'onglet : identité de la plateforme (Cowork #21). */
export function PlatformBanner({ tab }: { tab: PlatformTab }) {
  const identity = PLATFORM_IDENTITIES[tab];
  const Icon = PLATFORM_ICONS[tab];
  return (
    <section className="pf-banner mb-4 flex flex-wrap items-center gap-3 px-4 py-3" aria-label={`Section ${identity.name}`}>
      <Icon className="pf-ink h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="pf-ink flex items-center gap-2 font-display text-[15px] font-medium">
          {identity.name}
          {tab === "codeur" && <span className="pf-chip rounded px-1.5 font-data text-[10px] tracking-wider">FR</span>}
        </p>
        <p className="text-[12px] text-muted">{identity.tagline}</p>
      </div>
      {tab === "upwork" && <WorldClock />}
      {tab === "comeup" && <span className="pf-chip rounded-full px-2.5 py-0.5 text-[12px]">Commandes · Demandes</span>}
    </section>
  );
}
