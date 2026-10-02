import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { WARMUP_STEPS } from "@/lib/outbox/deliverability";
import type { Capacity } from "@/lib/today/capacity";

/** Plafond d'envois (montée en charge) et identité d'envoi : signature, lien de RDV. */
export function SendingCard({ capacity, signature, entryUrl }: { capacity: Capacity; signature: string; entryUrl: string | null }) {
  const steps = WARMUP_STEPS.map((step, index) => {
    const from = index === 0 ? 1 : WARMUP_STEPS[index - 1].untilDay + 1;
    const range = Number.isFinite(step.untilDay) ? `jours ${from} à ${step.untilDay}` : `à partir du jour ${from}`;
    return { range, cap: step.cap, current: capacity.warmupDay !== null && capacity.warmupDay >= from && capacity.warmupDay <= step.untilDay };
  });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Plafond d&apos;envois</CardTitle>
          <CardDescription>
            Montée en charge de l&apos;adresse d&apos;envoi, comptée en jours ouvrés depuis le premier envoi réel. Appliquée par le serveur à chaque envoi.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            Aujourd&apos;hui :{" "}
            <span className="font-data text-text">
              {capacity.warmupDay === null ? "aucun envoi encore" : `jour ${capacity.warmupDay}`} · {capacity.sentToday} / {capacity.dailyCap} envois
            </span>
          </p>
          <ul className="flex flex-col gap-1 text-[13px]">
            {steps.map((step) => (
              <li key={step.range} className={`flex justify-between gap-3 rounded-md px-2 py-1 ${step.current ? "bg-primary/10 text-primary-ink" : "text-muted"}`}>
                <span>{step.range}</span>
                <span className="font-data">{step.cap} / jour</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint">Fenêtre d&apos;envoi : 9 h – 17 h, jours ouvrés, 2 à 7 min entre deux mails.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Signature et lien de rendez-vous</CardTitle>
          <CardDescription>Ajoutés à chaque mail. Ils se modifient avec l&apos;offre, pour rester cohérents avec les preuves citées.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2/60 p-3 font-sans text-[13px] text-text">{signature}</pre>
          <p className="text-[13px] text-muted">
            Lien de RDV :{" "}
            {entryUrl ? (
              <a href={entryUrl} target="_blank" rel="noreferrer" className="break-all text-primary-ink underline-offset-2 hover:underline">
                {entryUrl}
              </a>
            ) : (
              <span className="text-faint">non renseigné</span>
            )}
          </p>
          <Link href="/offre" className="self-start rounded-lg border border-line px-3 py-1.5 text-[13px] text-text hover:bg-surface-2">
            Modifier dans « Offre »
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
