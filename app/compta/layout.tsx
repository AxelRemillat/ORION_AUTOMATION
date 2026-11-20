import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui";
import { badgeCounts, ZERO_BADGES } from "@/lib/badges/counts";
import { gardeCompta } from "@/lib/compta/acces";
import { modeDemo } from "@/lib/compta/contexte";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Layout de la comptabilité (Cowork #70) : même coquille que le reste d'ORION, accès réservé à Axel (gardeCompta).
 * L'entrée « Compta » de la barre est ajoutée par agent2 (refonte CRM) : la route existe dès cette PR.
 */
export default async function ComptaLayout({ children }: { children: React.ReactNode }) {
  const email = await gardeCompta();
  const badges = modeDemo() ? ZERO_BADGES : await badgeCounts(createClient());
  return (
    <ToastProvider>
      <AppShell email={email} badges={badges}>
        {modeDemo() && (
          <p className="mb-4 rounded-lg border border-warn/30 bg-warn/15 px-4 py-2 text-[13px] text-warn-ink">
            Mode démo local : données fictives en mémoire, rien n&apos;est écrit en base.
          </p>
        )}
        {children}
      </AppShell>
    </ToastProvider>
  );
}
