"use client";

import { useState } from "react";
import { EyeOff, Link2, Plus } from "lucide-react";
import { Button, Card, CardContent, EmptyState, Label, Select, useToast } from "@/components/ui";
import { PLATFORMS, PLATFORM_LABELS, type Opportunity, type Platform } from "@/lib/opportunities/types";
import { EMAIL_KIND_LABELS } from "@/lib/opportunities/email/parse";
import { TRIAGE_KINDS, TRIAGE_KIND_LABELS, type TriageKind } from "@/lib/opportunities/email/triage";
import type { OpportunityEmail } from "@/lib/opportunities/email/view";
import { ageLabel } from "@/lib/opportunities/view";

type Mode = "attach" | "create" | null;

/**
 * Onglet « À trier » : les e-mails de plateforme que l'ingestion n'a pas
 * reconnus. Trois actions : rattacher à une fiche, créer une fiche
 * (plateforme et type au choix), ignorer. Rien n'est supprimé.
 */
export function TriagePanel({
  emails,
  opportunities,
  onChanged,
  onCreated,
}: {
  emails: OpportunityEmail[];
  opportunities: Opportunity[];
  onChanged: (id: string, patch: Partial<OpportunityEmail>) => void;
  onCreated: (opportunityId: string) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<{ id: string; mode: Mode } | null>(null);
  const [target, setTarget] = useState("");
  const [platform, setPlatform] = useState<Platform>("upwork");
  const [kind, setKind] = useState<TriageKind>("demande");
  const [busy, setBusy] = useState<string | null>(null);

  function start(email: OpportunityEmail, mode: Mode) {
    setOpen({ id: email.id, mode });
    setTarget("");
    setPlatform(email.platform && email.platform !== "codeur" ? email.platform : "upwork");
    setKind("demande");
  }

  async function patch(email: OpportunityEmail, body: Record<string, unknown>, success: string) {
    setBusy(email.id);
    try {
      const response = await fetch(`/api/opportunites/emails/${email.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { patch?: Partial<OpportunityEmail>; error?: string };
      if (!response.ok || !result.patch) return toast.error(result.error ?? "Non enregistré.");
      onChanged(email.id, result.patch);
      setOpen(null);
      toast.success(success);
    } finally {
      setBusy(null);
    }
  }

  async function create(email: OpportunityEmail) {
    setBusy(email.id);
    try {
      const response = await fetch(`/api/opportunites/emails/${email.id}/fiche`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform, kind }) });
      const result = (await response.json()) as { id?: string; error?: string; warning?: string };
      if (!response.ok || !result.id) return toast.error(result.error ?? "Fiche non créée.");
      if (result.warning) toast.toast(`Fiche créée, mais ${result.warning}`, "info");
      onCreated(result.id);
    } finally {
      setBusy(null);
    }
  }

  if (!emails.length) {
    return <EmptyState title="Rien à trier" description="Les e-mails de plateforme non reconnus par l'ingestion arrivent ici, sans alerte." />;
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-line-soft">
          {emails.map((email) => (
            <li key={email.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-text">{email.subject || "(sans sujet)"}</p>
                  <p className="truncate text-[12px] text-muted">
                    {email.platform ? PLATFORM_LABELS[email.platform] : (email.from_address ?? "expéditeur inconnu")}
                    {email.received_at ? ` · ${ageLabel(email.received_at)}` : ""}
                    {email.kind !== "autre" ? ` · ${EMAIL_KIND_LABELS[email.kind]}` : ""}
                  </p>
                  {email.excerpt && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[12px] text-faint">{email.excerpt}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => start(email, "attach")} disabled={!opportunities.length}>
                    <Link2 className="h-3.5 w-3.5" aria-hidden /> Rattacher
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => start(email, "create")}>
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Créer une fiche
                  </Button>
                  <Button size="sm" variant="ghost" loading={busy === email.id && !open} onClick={() => patch(email, { status: "ignore" }, "E-mail ignoré (gardé pour l'historique).")}>
                    <EyeOff className="h-3.5 w-3.5" aria-hidden /> Ignorer
                  </Button>
                </div>
              </div>

              {open?.id === email.id && open.mode === "attach" && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line-soft bg-surface-2/60 p-3">
                  <div className="min-w-[240px] flex-1">
                    <Label htmlFor={`attach-${email.id}`}>Fiche existante</Label>
                    <Select id={`attach-${email.id}`} value={target} onChange={(event) => setTarget(event.target.value)}>
                      <option value="">Choisir une fiche…</option>
                      {opportunities.map((item) => (
                        <option key={item.id} value={item.id}>
                          {PLATFORM_LABELS[item.platform]} · {item.title.slice(0, 80)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button size="sm" disabled={!target} loading={busy === email.id} onClick={() => patch(email, { opportunity_id: target }, "E-mail rattaché à la fiche.")}>
                    Rattacher
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    Annuler
                  </Button>
                </div>
              )}

              {open?.id === email.id && open.mode === "create" && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line-soft bg-surface-2/60 p-3">
                  <div>
                    <Label htmlFor={`platform-${email.id}`}>Plateforme</Label>
                    <Select id={`platform-${email.id}`} value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
                      {PLATFORMS.map((value) => (
                        <option key={value} value={value}>
                          {PLATFORM_LABELS[value]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`kind-${email.id}`}>Type</Label>
                    <Select id={`kind-${email.id}`} value={kind} onChange={(event) => setKind(event.target.value as TriageKind)}>
                      {TRIAGE_KINDS.map((value) => (
                        <option key={value} value={value}>
                          {TRIAGE_KIND_LABELS[value]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button size="sm" loading={busy === email.id} onClick={() => create(email)}>
                    Créer la fiche
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    Annuler
                  </Button>
                  <p className="w-full text-[12px] text-faint">Demande ou invitation : analyse et proposition comme une annonce collée. Rien n&apos;est envoyé.</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
