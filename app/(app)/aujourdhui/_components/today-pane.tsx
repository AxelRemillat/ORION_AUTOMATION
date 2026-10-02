"use client";

import { Check, PenLine, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { PreflightPanel } from "@/components/mail/preflight-panel";
import { usePreflight } from "@/components/mail/use-preflight";
import { joinBody } from "@/lib/today/body";
import type { TodayItem } from "@/lib/today/types";
import type { DiscardReason } from "@/types";
import { CompletionPanel } from "./completion-panel";
import { DiscardReasons } from "./discard-reasons";
import { MailEditor } from "./mail-editor";
import { MissingDraft } from "./missing-draft";
import { ReceivedMessage, SignalFacts, WhyProspect } from "./pane-context";
import type { Draft } from "./use-today-state";

/**
 * Panneau de droite : l'élément sélectionné, de quoi juger, le mail, le
 * contrôle avant envoi, et les trois gestes (Écarter X, Modifier E, Valider V).
 * « Valider » reste grisé tant qu'une règle bloquante échoue.
 */

const TYPE_CHIP = { intro: "Intro", relance: "Relance, même fil", reponse: "Réponse" } as const;
export const EDITOR_ID = "today-editor";

/** Le panneau de complétion ne sert que s'il manque un contact ou un site — pas un simple brouillon. */
const CONTACT_TAGS = new Set(["Email manquant", "Email non vérifié", "Site introuvable"]);
const needsContact = (item: TodayItem) => item.tags.some((tag) => CONTACT_TAGS.has(tag));

export function TodayPane({
  item,
  draft,
  discarding,
  onEdit,
  onBlur,
  onValidate,
  onDiscard,
  onAskDiscard,
  onCancelDiscard,
  onRefresh,
}: {
  item: TodayItem;
  draft: Draft;
  discarding: boolean;
  onEdit: (patch: Partial<Draft>) => void;
  onBlur: () => void;
  onValidate: (on: boolean) => void;
  onDiscard: (reason: DiscardReason) => void;
  onAskDiscard: () => void;
  onCancelDiscard: () => void;
  onRefresh: () => void;
}) {
  const body = joinBody(draft.core, item);
  const { result, loading } = usePreflight(
    { subject: draft.subject, body, to: item.contact.email, prospectId: item.prospectId, kind: item.kind === "reponse" ? "reponse" : "prospection" },
    Boolean(item.messageId),
  );
  const locked = item.status === "programme" || item.status === "envoye";
  const blocked = !item.messageId || locked || (result !== null && !result.ok);

  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-mist" aria-label={item.companyName}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-semibold text-text">{item.companyName}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <Badge key={tag} tone="warning">{tag}</Badge>
            ))}
            {item.contact.kind === "nominatif" && <Badge tone="success">✓ email nominatif</Badge>}
            {item.contact.kind === "generique" && <Badge tone="neutral">email générique</Badge>}
            <Badge tone="info">{TYPE_CHIP[item.messageType]}</Badge>
            {item.score != null && <Badge tone="accent">score {item.score}/5</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={onAskDiscard} disabled={locked} aria-keyshortcuts="X">
            <X className="h-3.5 w-3.5" aria-hidden /> Écarter <kbd className="font-data text-[10px] text-faint">X</kbd>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => document.getElementById(EDITOR_ID)?.focus()} disabled={!item.messageId || locked} aria-keyshortcuts="E">
            <PenLine className="h-3.5 w-3.5" aria-hidden /> Modifier <kbd className="font-data text-[10px] text-faint">E</kbd>
          </Button>
          {item.status === "valide" ? (
            <Button size="sm" variant="secondary" onClick={() => onValidate(false)}>
              <Check className="h-3.5 w-3.5" aria-hidden /> Validé · retirer
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onValidate(true)} disabled={blocked} aria-keyshortcuts="V">
              <Check className="h-3.5 w-3.5" aria-hidden /> Valider <kbd className="font-data text-[10px] text-faint">V</kbd>
            </Button>
          )}
        </div>
      </header>

      {discarding && <DiscardReasons onPick={onDiscard} onCancel={onCancelDiscard} />}
      {item.kind === "a_completer" && needsContact(item) && <CompletionPanel key={item.key} item={item} onDone={onRefresh} />}
      <ReceivedMessage item={item} />
      <SignalFacts item={item} />
      {item.messageId ? (
        <>
          <MailEditor item={item} draft={draft} textareaId={EDITOR_ID} onChange={onEdit} onBlur={onBlur} />
          <PreflightPanel result={result} loading={loading} />
        </>
      ) : (
        <MissingDraft item={item} onDone={onRefresh} />
      )}
      {item.scheduledAt && (
        <p className="font-data text-[12px] text-primary-ink">
          Programmé le {new Date(item.scheduledAt).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
      <WhyProspect item={item} />
    </article>
  );
}
