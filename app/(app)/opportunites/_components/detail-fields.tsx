import { useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { OPPORTUNITY_STATUSES, STATUS_LABELS, type Opportunity, type OpportunityStatus } from "@/lib/opportunities/types";
import { ageLabel } from "@/lib/opportunities/view";
import { EMAIL_KIND_LABELS } from "@/lib/opportunities/email/parse";
import type { OpportunityEmail } from "@/lib/opportunities/email/view";
import type { OpportunityActions } from "./use-opportunity-actions";

/** Bas de fiche : annonce complète à coller, statut, montant signé, notes, suivi par e-mail, texte de l'annonce. */
export function DetailFields({ selected, emails, actions }: { selected: Opportunity; emails: OpportunityEmail[]; actions: OpportunityActions }) {
  const { busy, patch, regenerateFromFullText } = actions;
  const [fullText, setFullText] = useState("");
  return (
    <>
      {selected.description_truncated && (
        <div className="rounded-lg border border-warn/25 bg-warn/5 p-3">
          <Label htmlFor="full-text">Coller l&apos;annonce complète</Label>
          <p className="mb-1.5 text-[12px] text-muted">Le flux ne donne qu&apos;un extrait : collez le texte complet depuis Codeur, puis régénérez.</p>
          <Textarea id="full-text" rows={5} value={fullText} onChange={(event) => setFullText(event.target.value)} />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              loading={busy === `regen:${selected.id}` || busy === `patch:${selected.id}`}
              onClick={async () => {
                if (await regenerateFromFullText(selected.id, fullText)) setFullText("");
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Régénérer
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="opportunity-status">Statut</Label>
          <Select id="opportunity-status" value={selected.status} onChange={(event) => patch(selected.id, { status: event.target.value as OpportunityStatus }, "Statut enregistré.")}>
            {OPPORTUNITY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="opportunity-amount">Montant signé (€)</Label>
          <Input
            id="opportunity-amount"
            key={`amount:${selected.id}`}
            inputMode="decimal"
            defaultValue={selected.amount_eur ?? ""}
            placeholder="à la signature"
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value !== String(selected.amount_eur ?? "")) void patch(selected.id, { amount_eur: value || null }, "Montant enregistré.");
            }}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="opportunity-notes">Notes</Label>
        <Textarea
          id="opportunity-notes"
          key={`notes:${selected.id}`}
          defaultValue={selected.notes ?? ""}
          rows={3}
          onBlur={(event) => {
            if (event.target.value !== (selected.notes ?? "")) void patch(selected.id, { notes: event.target.value }, "Notes enregistrées.");
          }}
        />
      </div>
      {emails.length > 0 && (
        <div>
          <Label>Suivi par e-mail</Label>
          <ul className="mt-1 space-y-1">
            {emails.map((email) => (
              <li key={email.id} className="flex items-start gap-2 text-[12px]">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="text-text">{EMAIL_KIND_LABELS[email.kind]}</span>
                  <span className="text-muted"> · {email.subject || "(sans sujet)"}</span>
                  {email.received_at && <span className="font-data text-faint"> · {ageLabel(email.received_at)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-[12px] text-muted">
        <summary className="cursor-pointer">Texte de l&apos;annonce{selected.description_truncated ? " (extrait du flux)" : ""}</summary>
        <p className="mt-2 whitespace-pre-wrap">{selected.body}</p>
        {selected.categories?.length ? <p className="mt-1 text-faint">Catégories : {selected.categories.join(" · ")}</p> : null}
      </details>
    </>
  );
}
