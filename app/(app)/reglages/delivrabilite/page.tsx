import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { checkDomain, SENDING_DOMAIN } from "@/lib/settings/dns";
import { loadVolumes } from "@/lib/settings/volumes-server";
import { createClient } from "@/lib/supabase/server";
import { loadCapacity } from "@/lib/today/capacity";
import { DncCard } from "./dnc-card";
import { DnsCard } from "./dns-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "Délivrabilité · Réglages · ORION" };

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")} %`);

/** Réglages › Délivrabilité : DNS, montée en charge, rebonds et plaintes, « ne plus contacter ». */
export default async function DelivrabilitePage() {
  const user = await requireUser();
  const db = createClient();
  const [checks, capacity, volumes, prospects] = await Promise.all([
    checkDomain(SENDING_DOMAIN).catch(() => []),
    loadCapacity(db, user.id),
    loadVolumes(db, user.id),
    db.from("prospects").select("id, company_name, city, do_not_contact").is("deleted_at", null).order("company_name").limit(5_000),
  ]);
  const rows = (prospects.data ?? []).map((row) => ({ id: row.id as string, name: row.company_name as string, city: (row.city as string | null) ?? null, dnc: Boolean(row.do_not_contact) }));
  const highBounce = volumes.bounceRate !== null && volumes.bounceRate > 0.03;

  return (
    <>
      <PageHeader title="Délivrabilité" description="Ce qui décide si les mails arrivent en boîte de réception." />
      <div className="flex flex-col gap-6">
        <DnsCard domain={SENDING_DOMAIN} checks={checks} />
        <Card>
          <CardHeader>
            <CardTitle>Montée en charge et réputation</CardTitle>
            <CardDescription>Plafond du jour appliqué par le serveur ; rebonds lus dans la boîte de réception.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Montée en charge", value: capacity.warmupDay === null ? "—" : `jour ${capacity.warmupDay}`, hint: "jours ouvrés depuis le 1er envoi réel" },
              { label: "Envois aujourd'hui", value: `${capacity.sentToday} / ${capacity.dailyCap}`, hint: "plafond du jour" },
              { label: "Taux de rebond", value: pct(volumes.bounceRate), hint: `${volumes.bounces} rebond(s) sur ${volumes.sent} envois${highBounce ? " · au-dessus de 3 %" : ""}` },
              { label: "Plaintes (spam)", value: "—", hint: "non mesurées sans Google Postmaster Tools" },
            ].map((stat) => (
              <div key={stat.label} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-2/60 p-3">
                <span className="text-[12px] text-muted">{stat.label}</span>
                <span className={`font-data text-[20px] ${stat.label === "Taux de rebond" && highBounce ? "text-lost-ink" : "text-text"}`}>{stat.value}</span>
                <span className="text-[11px] text-faint">{stat.hint}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <DncCard
          blocked={rows.filter((row) => row.dnc)}
          candidates={rows.filter((row) => !row.dnc)}
        />
      </div>
    </>
  );
}
