import Link from "next/link";
import type { TodayItem } from "@/lib/today/types";

/**
 * Contexte de l'élément : message reçu (réponse), signal daté et sa source,
 * trois ou quatre faits clés, et « Pourquoi ce prospect » replié.
 */

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : null);

export function ReceivedMessage({ item }: { item: TodayItem }) {
  if (!item.received) return null;
  return (
    <section className="rounded-xl border border-line-soft bg-surface-2/60 p-3">
      <p className="mb-1 font-data text-[10px] uppercase tracking-wide text-faint">
        Message reçu · {new Date(item.received.at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
      </p>
      <p className="max-h-48 overflow-y-auto whitespace-pre-line text-[13px] text-text">{item.received.body}</p>
    </section>
  );
}

export function SignalFacts({ item }: { item: TodayItem }) {
  if (!item.signal && !item.facts.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {item.signal && (
        <>
          <dt className="text-muted">Signal</dt>
          <dd className="text-text">
            {item.signal.url ? (
              <a href={item.signal.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                {item.signal.label}
              </a>
            ) : (
              item.signal.label
            )}
            <span className="font-data text-[11px] text-faint"> · {[day(item.signal.date), item.signal.source].filter(Boolean).join(" · ")}</span>
          </dd>
        </>
      )}
      {item.facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-muted">{fact.label}</dt>
          <dd className="text-text">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WhyProspect({ item }: { item: TodayItem }) {
  if (!item.why.length && !item.prospectId) return null;
  return (
    <details className="rounded-lg border border-line-soft px-3 py-2 text-[13px]">
      <summary className="cursor-pointer text-muted">Pourquoi ce prospect</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-text">
        {item.why.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {item.prospectId && (
        <Link href={`/suivi/${item.prospectId}`} className="mt-2 inline-block text-[12px] text-primary-ink underline-offset-2 hover:underline">
          Ouvrir la fiche
        </Link>
      )}
    </details>
  );
}
