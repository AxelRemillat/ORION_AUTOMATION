import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { ReglagesNav } from "./_components/reglages-nav";
import { OpenAiQuotaBanner } from "@/components/layout/openai-quota-banner";

export const metadata = { title: "Réglages · ORION" };

/**
 * Réglages — remplace les anciennes pages Stats et Coûts (redirigées, voir
 * next.config.mjs). Menu à gauche, une section par URL.
 */
export default async function ReglagesLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <p className="mb-2 px-1 font-data text-[11px] uppercase tracking-wider text-faint lg:px-3">Réglages</p>
        <ReglagesNav />
      </aside>
      <div className="flex min-w-0 flex-col gap-4">
        <OpenAiQuotaBanner withLink={false} />
        <div>{children}</div>
      </div>
    </div>
  );
}
