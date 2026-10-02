import Link from "next/link";
import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { Volumes } from "@/lib/settings/volumes";

/** Volumes : prospects par statut et par étiquette, envois, réponses, rebonds. Lecture seule. */

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")} %`);

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-2/60 p-3">
      <span className="text-[12px] text-muted">{label}</span>
      <span className="font-data text-[20px] text-text">{value}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[12px] font-medium text-muted">{title}</p>
      {rows.length ? (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="truncate text-text">{row.label}</span>
              <span className="font-data text-muted">{row.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-faint">Rien pour l&apos;instant.</p>
      )}
    </div>
  );
}

export function VolumesCard({ volumes }: { volumes: Volumes }) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>Volumes</CardTitle>
          <CardDescription>Ce que contient ORION aujourd&apos;hui. Lecture seule : aucune suppression en masse ici.</CardDescription>
        </div>
        <Link
          href="/reglages/donnees/export"
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-text hover:bg-surface-2"
        >
          <Download className="h-4 w-4" aria-hidden />
          Exporter les prospects (CSV)
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Prospects" value={volumes.prospects} hint={`${volumes.doNotContact} « ne plus contacter »`} />
          <Stat label="Mails envoyés" value={volumes.sent} hint={volumes.failed ? `${volumes.failed} envoi(s) en échec` : undefined} />
          <Stat label="Réponses reçues" value={volumes.replies} />
          <Stat label="Rebonds" value={volumes.bounces} hint={`taux ${pct(volumes.bounceRate)}`} />
          <Stat label="Plaintes" value="—" hint="non mesurées (Google Postmaster non connecté)" />
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <Breakdown title="Prospects par statut" rows={volumes.byStatus.map((row) => ({ label: row.label, count: row.count }))} />
          <Breakdown title="Fiches de « Aujourd'hui » par étiquette" rows={volumes.byTag.map((row) => ({ label: row.tag, count: row.count }))} />
        </div>
      </CardContent>
    </Card>
  );
}
