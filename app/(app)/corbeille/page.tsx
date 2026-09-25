import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { purgeExpired } from "@/lib/trash/operations";
import { TRASH_RETENTION_DAYS } from "@/lib/trash/retention";
import { trashedProspects } from "@/lib/trash/scope";
import type { ExcludedCompany, Prospect } from "@/types";
import { ExcludedList } from "./_components/excluded-list";
import { TrashList } from "./_components/trash-list";

export const metadata = { title: "Corbeille · ORION" };
export const dynamic = "force-dynamic";

type Tab = "corbeille" | "exclus";

/**
 * Corbeille : prospects supprimés depuis moins de 14 jours, et SIREN exclus
 * de la recherche après une suppression définitive.
 */
export default async function CorbeillePage({ searchParams }: { searchParams: { onglet?: string } }) {
  await requireUser();
  const supabase = createClient();
  const tab: Tab = searchParams.onglet === "exclus" ? "exclus" : "corbeille";

  // Filet du cron : ce qui a dépassé 14 jours est purgé dès l'ouverture de la
  // page. Un échec (migration absente, panne) n'empêche pas l'affichage.
  await purgeExpired(supabase).catch(() => null);

  const [trashed, excluded] = await Promise.all([
    trashedProspects(supabase),
    supabase.from("excluded_companies").select("*").order("created_at", { ascending: false }),
  ]);
  const prospects = (trashed.data ?? []) as Prospect[];
  const exclusions = (excluded.data ?? []) as ExcludedCompany[];

  return (
    <>
      <PageHeader
        title="Corbeille"
        description={`Les prospects supprimés restent ici ${TRASH_RETENTION_DAYS} jours, puis disparaissent définitivement avec leurs messages, deals et relances.`}
      />

      <nav aria-label="Onglets de la corbeille" className="mb-5 flex gap-1 border-b border-line">
        <TabLink href="/corbeille" active={tab === "corbeille"} label="Corbeille" count={prospects.length} />
        <TabLink href="/corbeille?onglet=exclus" active={tab === "exclus"} label="Exclus" count={exclusions.length} />
      </nav>

      {tab === "corbeille" ? <TrashList prospects={prospects} /> : <ExcludedList exclusions={exclusions} />}
    </>
  );
}

function TabLink({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active ? "border-primary text-text" : "border-transparent text-muted hover:text-text",
      )}
    >
      {label}
      <span className="font-data ml-1.5 text-[12px] text-faint">{count}</span>
    </Link>
  );
}
