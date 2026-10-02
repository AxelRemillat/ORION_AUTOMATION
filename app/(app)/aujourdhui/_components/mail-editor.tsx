"use client";

import { Lock } from "lucide-react";
import { Label, Textarea } from "@/components/ui";
import { SubjectField } from "@/components/mail/subject-field";
import { OPT_OUT_SENTENCE } from "@/lib/mail-preflight/opt-out";
import type { TodayItem } from "@/lib/today/types";
import type { Draft } from "./use-today-state";

/**
 * Le mail : destinataire, objet, texte éditable, puis les lignes VERROUILLÉES
 * (mention « stop » et signature) — affichées, jamais éditables, et hors du
 * compte de mots. Objet : le champ partagé de l'app (« Proposer un objet »).
 */
export function MailEditor({
  item,
  draft,
  textareaId,
  onChange,
  onBlur,
}: {
  item: TodayItem;
  draft: Draft;
  textareaId: string;
  onChange: (patch: Partial<Draft>) => void;
  onBlur: () => void;
}) {
  const words = draft.core.trim() ? draft.core.trim().split(/\s+/).length : 0;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line-soft bg-surface-2/40 p-3" onBlur={onBlur}>
      <p className="font-data text-[12px] text-muted">
        À : <span className="text-text">{item.contact.email ?? "adresse manquante"}</span>
        {item.contact.name && <span className="text-faint"> · {item.contact.name}</span>}
      </p>
      <SubjectField
        id={`${textareaId}-subject`}
        value={draft.subject}
        body={draft.core}
        needsReview={false}
        prospectId={item.prospectId}
        onChange={(subject) => onChange({ subject })}
        onConfirm={() => undefined}
      />
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={textareaId}>Message</Label>
          <span className="font-data text-[11px] text-faint">{words} mots</span>
        </div>
        <Textarea
          id={textareaId}
          rows={9}
          value={draft.core}
          onChange={(event) => onChange({ core: event.target.value })}
          className="font-sans text-[13px] leading-relaxed"
        />
      </div>
      {item.optOut && <LockedLine label="Ajouté">{OPT_OUT_SENTENCE}</LockedLine>}
      {item.signature && <LockedLine label="Signature">{item.signature}</LockedLine>}
    </section>
  );
}

function LockedLine({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-line px-2.5 py-1.5" aria-label={`${label} (non modifiable)`}>
      <Lock className="mt-0.5 h-3 w-3 shrink-0 text-faint" aria-hidden />
      <span className="shrink-0 font-data text-[10px] uppercase tracking-wide text-faint">{label}</span>
      <p className="whitespace-pre-line text-[12px] text-muted">{children}</p>
    </div>
  );
}
