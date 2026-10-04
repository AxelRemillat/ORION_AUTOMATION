import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { checkDomain, SENDING_DOMAIN } from "@/lib/settings/dns";
import { loadVolumes } from "@/lib/settings/volumes-server";
import { readAll } from "@/lib/supabase/read-all";
import { createClient } from "@/lib/supabase/server";
import { loadCapacity } from "@/lib/today/capacity";
import { DncCard } from "./dnc-card";
import { DnsCard } from "./dns-card";
import { RampCard } from "./ramp-card";
import { nextRampStep, type RampInbound } from "@/lib/settings/ramp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Délivrabilité · Réglages · ORION" };

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1).replace(".", ",")} %`);

/** Réglages › Délivrabilité : DNS, montée en charge, rebonds et plaintes, « ne plus contacter ». */
export default async function DelivrabilitePage() {
  const user = await requireUser();
  const db = createClient();
  const [checks, capacity, volumes, prospects, inbound] = await Promise.all([
    checkDomain(SENDING_DOMAIN).catch(() => []),
    loadCapacity(db, user.id),
    loadVolumes(db, user.id),
    readAll<{ id: string; company_name: string; city: string | null; do_not_contact: boolean | null }>(() =>
      db.from("prospects").select("id, company_name, city, do_not_contact").is("deleted_at", null).order("company_name").order("id"),
    ),
    readAll<RampInbound & { id: string }>(() =>
      db.from("inbound_messages").select("id, from_email, subject, body, category, received_at").is("deleted_at", null).order("id"),
    ).catch(() => []),
  ]);
  const ramp = nextRampStep({
    currentCap: capacity.dailyCap,
    sentTotal: volumes.sent,
    inbound,
    dnsOk: { spf: checks.find((c) => c.name === "SPF")?.verdict === "ok", dkim: checks.find((c) => c.name === "DKIM")?.verdict === "ok" },
  });
  const rows = prospects.map((row) => ({ id: row.id, name: row.company_name, city: row.city ?? null, dnc: Boolean(row.do_not_contact) }));
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
            ].map((stat) => (
              <div key={stat.label} className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-2/60 p-3">
                <span className="text-[12px] text-muted">{stat.label}</span>
                <span className={`font-data text-[20px] ${stat.label === "Taux de rebond" && highBounce ? "text-lost-ink" : "text-text"}`}>{stat.value}</span>
                <span className="text-[11px] text-faint">{stat.hint}</span>
              </div>
            ))}
            {/* Plaintes : pas d'intégration Postmaster pour l'instant, un test de placement à la main. */}
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface-2/60 p-3">
              <span className="text-[12px] text-muted">Plaintes (spam)</span>
              <span className="text-[13px] text-text">Vérifie le placement avec un test mail-tester.com</span>
              <a
                href="https://www.mail-tester.com"
                target="_blank"
                rel="noopener noreferrer"
                className="self-start text-[12px] text-primary-ink underline-offset-2 hover:underline"
              >
                Ouvrir mail-tester.com ↗
              </a>
            </div>
          </CardContent>
        </Card>
        <RampCard current={ramp.current} target={ramp.target} ready={ramp.ready} conditions={ramp.conditions} />
        <DncCard
          blocked={rows.filter((row) => row.dnc)}
          candidates={rows.filter((row) => !row.dnc)}
        />
      </div>
    </>
  );
}
