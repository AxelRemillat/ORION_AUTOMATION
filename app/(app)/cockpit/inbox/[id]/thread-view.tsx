import { formatDateTime } from "@/lib/utils";

/** Une entrée du fil, quel que soit son sens. */
export interface ThreadEntry {
  id: string;
  who: "moi" | "lui";
  subject: string | null;
  body: string;
  at: string;
  /** Vrai pour le message auquel on est en train de répondre. */
  answering?: boolean;
}

/**
 * Le fil complet, envoyé et reçu mêlés, du plus ancien au plus récent.
 *
 * Les messages reçus portent le registre chaud de la boîte de réception, les
 * miens restent neutres : on lit d'un coup d'œil qui a dit quoi.
 */
export function ThreadView({ entries }: { entries: ThreadEntry[] }) {
  if (!entries.length) {
    return (
      <p className="text-[13px] text-muted">
        Aucun échange antérieur : ce message est le premier de la conversation.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry) => {
        const received = entry.who === "lui";
        return (
          <li
            key={entry.id}
            className="rounded-xl border p-4"
            style={{
              borderColor: received ? "rgb(var(--rgb-warn) / 0.35)" : "var(--line)",
              background: received ? "var(--warn-soft)" : "var(--surface)",
              // Le message auquel on répond est mis en avant par un liseré.
              boxShadow: entry.answering ? "inset 3px 0 0 0 rgb(var(--rgb-warn))" : undefined,
            }}
          >
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span
                className={`text-[12px] font-semibold ${received ? "text-warn-ink" : "text-primary-ink"}`}
              >
                {received ? "Reçu" : "Envoyé"}
                {entry.answering && " · message auquel vous répondez"}
              </span>
              <span className="font-data text-[11px] text-faint">{formatDateTime(entry.at)}</span>
            </div>

            {entry.subject && (
              <p className="mb-1 text-[13px] font-medium text-text">{entry.subject}</p>
            )}
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
              {entry.body}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
