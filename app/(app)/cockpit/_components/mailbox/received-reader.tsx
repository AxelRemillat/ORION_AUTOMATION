"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MailTrashButton } from "@/components/outbox/mail-trash-button";
import { DoNotContactButton } from "@/components/outbox/do-not-contact-button";
import { AntispamControls } from "@/components/outbox/antispam-controls";
import { formatParisDateTime } from "@/lib/outbox/paris-time";
import type { InboxEntry } from "../../_lib/types";
import { CategoryBadge } from "./category-badge";
import { ReadToggle, useAutoRead } from "./read-toggle";

/**
 * Volet de LECTURE d'un mail reçu : l'en-tête, le corps, les actions
 * (répondre, lu / non lu, corbeille, « ne plus contacter »).
 *
 * L'ouvrir le marque lu au bout de 2 s — le temps de le lire, pas celui de
 * passer dessus en feuilletant la liste.
 */
export function ReceivedReader({ entry, onTrashed }: { entry: InboxEntry; onTrashed: () => void }) {
  useAutoRead(entry.id, entry.unread);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-text">{entry.subject ?? "(sans objet)"}</h3>
          <p className="font-data mt-0.5 truncate text-[12px] text-muted">
            {entry.label !== entry.fromEmail && `${entry.label} · `}
            {entry.fromEmail}
          </p>
          <p className="font-data mt-0.5 text-[11px] text-faint">{formatParisDateTime(entry.receivedAt)}</p>
        </div>
        <CategoryBadge category={entry.category} auto={entry.autoKind} />
      </div>

      <p className="scrollbar-thin mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
        {entry.body}
      </p>

      {entry.autoKind === "antispam" && (
        <AntispamControls inboundId={entry.id} link={entry.validationLink} validated={entry.validated} />
      )}
      {entry.autoKind === "absence" && (
        <p className="mt-4 text-[12px] text-faint">Réponse automatique : pas une réponse du prospect, les relances continuent.</p>
      )}
      {entry.autoKind === "parti" && (
        <p className="mt-4 text-[12px] text-faint">Contact parti : plus aucune relance vers cette adresse. Les contacts cités sont proposés sur la fiche.</p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {/* Réponse automatique : personne à qui répondre, pas de « Répondre » IA. */}
        {!entry.autoKind && (
          <Link
            href={`/cockpit/inbox/${entry.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-warn/45 bg-warn/10 px-3 py-1.5 text-[13px] font-medium text-warn-ink motion-safe:transition-colors"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Répondre
          </Link>
        )}
        <ReadToggle id={entry.id} unread={entry.unread} variant="labelled" />
        {entry.prospectId && (
          <Link href={`/suivi/${entry.prospectId}`} className="text-[13px] text-muted hover:text-text">
            Fiche prospect
          </Link>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {entry.prospectId && (
            <DoNotContactButton prospectId={entry.prospectId} companyName={entry.label} active={entry.doNotContact} />
          )}
          <MailTrashButton
            messageId={entry.id}
            kind="received"
            label={`le mail de ${entry.label}`}
            onTrashed={onTrashed}
          />
        </span>
      </div>
    </>
  );
}
