"use client";

import { useMemo, useState } from "react";
import { Briefcase, Copy, Plus, RefreshCw, Send } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { OPPORTUNITY_STATUSES, PLATFORMS, PLATFORM_LABELS, STATUS_LABELS, type Opportunity, type OpportunityStatus, type Platform } from "@/lib/opportunities/types";

const EMPTY_FORM = { platform: "codeur" as Platform, url: "", title: "", body: "", budget: "", deadline: "" };

const scoreTone = (score: number | null) => (score == null ? "neutral" : score >= 8 ? "success" : score >= 5 ? "warning" : "danger");

/** Liste, ajout, analyse et suivi des opportunités. Aucun envoi : on copie, puis on marque « envoyée ». */
export function OpportunitiesClient({ initial, focusId }: { initial: Opportunity[]; focusId?: string | null }) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>((focusId && initial.some((item) => item.id === focusId) ? focusId : null) ?? initial[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  /** Relecture complète (analyse et proposition sont écrites côté serveur), sur l'opportunité concernée. */
  function reload(focus?: string) {
    window.location.assign(focus ? `/opportunites?id=${encodeURIComponent(focus)}` : "/opportunites");
  }

  async function create() {
    setBusy("create");
    try {
      const response = await fetch("/api/opportunites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = (await response.json()) as { id?: string; error?: string; warning?: string };
      if (!response.ok || !result.id) {
        toast.error(result.error ?? "Opportunité non enregistrée.");
        return;
      }
      if (result.warning) toast.toast(`Enregistrée, mais ${result.warning}`, "info");
      else toast.success("Opportunité analysée, proposition prête.");
      setAdding(false);
      setForm(EMPTY_FORM);
      reload(result.id);
    } finally {
      setBusy(null);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, success: string) {
    setBusy(`patch:${id}`);
    try {
      const response = await fetch(`/api/opportunites/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { patch?: Partial<Opportunity>; error?: string };
      if (!response.ok || !result.patch) {
        toast.error(result.error ?? "Non enregistré.");
        return;
      }
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...result.patch } : item)));
      toast.success(success);
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(id: string) {
    setBusy(`regen:${id}`);
    try {
      const response = await fetch(`/api/opportunites/${id}/regenerer`, { method: "POST" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) toast.error(result.error ?? "Analyse indisponible.");
      else reload(id);
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Proposition copiée : collez-la sur la plateforme.");
    } catch {
      toast.error("Copie impossible : sélectionnez le texte à la main.");
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Ajouter
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-6 w-6" aria-hidden />}
          title="Aucune opportunité"
          description="Collez une annonce Codeur, Upwork, ComeUp ou Malt : l'app l'analyse et rédige une proposition à copier."
          action={<Button onClick={() => setAdding(true)}>Ajouter une annonce</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-line-soft">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2", item.id === selectedId && "bg-surface-2")}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-text">{item.title}</p>
                        <p className="truncate text-[12px] text-muted">
                          {PLATFORM_LABELS[item.platform]}
                          {item.budget ? ` · ${item.budget}` : ""}
                          {item.deadline ? ` · avant le ${item.deadline}` : ""}
                        </p>
                      </div>
                      {item.fit_score != null && <Badge tone={scoreTone(item.fit_score)}>{item.fit_score}/10</Badge>}
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{STATUS_LABELS[item.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {selected && (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div>
                  <p className="text-[12px] text-faint">
                    {PLATFORM_LABELS[selected.platform]}
                    {selected.url && (
                      <>
                        {" · "}
                        <a href={selected.url} target="_blank" rel="noreferrer" className="text-primary-ink underline">
                          voir l&apos;annonce
                        </a>
                      </>
                    )}
                  </p>
                  <h2 className="font-display text-lg text-text">{selected.title}</h2>
                </div>

                {selected.fit_score == null ? (
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    Analyse absente.
                    <Button size="sm" variant="outline" loading={busy === `regen:${selected.id}`} onClick={() => regenerate(selected.id)}>
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Analyser
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-line-soft bg-surface-2/60 p-3 text-[13px]">
                    <p className="mb-1 font-medium text-text">
                      Adéquation <span className="font-data">{selected.fit_score}/10</span>
                      {selected.language && <span className="ml-2 text-[11px] text-faint">langue : {selected.language.toUpperCase()}</span>}
                    </p>
                    <ul className="mb-2 list-disc pl-5 text-muted">
                      {(selected.fit_reasons ?? []).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    {selected.need && <p className="text-text">Besoin : {selected.need}</p>}
                  </div>
                )}

                {selected.proposal && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <Label>Proposition</Label>
                      {selected.proposal_score != null && (
                        <span
                          title={selected.proposal_reason ?? "Note du relecteur automatique (9 = à poster telle quelle)"}
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 font-data text-[10px]",
                            selected.proposal_score >= 9 ? "border-good/25 bg-good/10 text-good-ink" : "border-warn/25 bg-warn/10 text-warn-ink",
                          )}
                        >
                          {selected.proposal_score}/10
                        </span>
                      )}
                    </div>
                    {selected.proposal_reason && <p className="mb-1.5 text-[12px] text-warn-ink">À revoir — {selected.proposal_reason}</p>}
                    <Textarea
                      key={`${selected.id}:${selected.updated_at}`}
                      defaultValue={selected.proposal}
                      rows={14}
                      onBlur={(event) => {
                        if (event.target.value.trim() !== selected.proposal?.trim()) void patch(selected.id, { proposal: event.target.value }, "Proposition enregistrée.");
                      }}
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => copy(selected.proposal ?? "")}>
                        <Copy className="h-3.5 w-3.5" aria-hidden /> Copier la proposition
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={selected.status !== "a_repondre"}
                        loading={busy === `patch:${selected.id}`}
                        onClick={() => patch(selected.id, { status: "envoyee" }, "Marquée envoyée.")}
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden /> Marquer envoyée
                      </Button>
                      <Button size="sm" variant="ghost" loading={busy === `regen:${selected.id}`} onClick={() => regenerate(selected.id)}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Régénérer
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="opportunity-status">Statut</Label>
                    <Select
                      id="opportunity-status"
                      value={selected.status}
                      onChange={(event) => patch(selected.id, { status: event.target.value as OpportunityStatus }, "Statut enregistré.")}
                    >
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
                <details className="text-[12px] text-muted">
                  <summary className="cursor-pointer">Texte de l&apos;annonce</summary>
                  <p className="mt-2 whitespace-pre-wrap">{selected.body}</p>
                </details>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Ajouter une opportunité"
        description="Collez l'annonce : l'analyse et la proposition prennent une trentaine de secondes."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Annuler
            </Button>
            <Button loading={busy === "create"} onClick={create}>
              Analyser et rédiger
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-platform">Plateforme</Label>
            <Select id="new-platform" value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as Platform })}>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {PLATFORM_LABELS[platform]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="new-url">URL de l&apos;annonce</Label>
            <Input id="new-url" value={form.url} placeholder="https://…" onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="new-title">Titre</Label>
            <Input id="new-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="new-body">Texte de l&apos;annonce</Label>
            <Textarea id="new-body" rows={8} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="new-budget">Budget</Label>
            <Input id="new-budget" value={form.budget} placeholder="ex. 500 à 1 000 €" onChange={(event) => setForm({ ...form, budget: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="new-deadline">Date limite</Label>
            <Input id="new-deadline" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
          </div>
        </div>
      </Modal>
    </>
  );
}
