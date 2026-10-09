"use client";

import { useMemo, useState } from "react";
import { Bell, Briefcase, ClipboardPaste, Copy, ExternalLink, Inbox, Mail, RefreshCw, Send } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, Input, Label, Modal, Select, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { OPPORTUNITY_STATUSES, PLATFORMS, PLATFORM_LABELS, STATUS_LABELS, type Opportunity, type OpportunityStatus, type Platform } from "@/lib/opportunities/types";
import { ageLabel, BUCKET_LABELS, bucketOf, SIZE_BADGE, sizeFlag, staleLabel, unseenAlerts, type Bucket } from "@/lib/opportunities/view";
import { EMAIL_KIND_LABELS } from "@/lib/opportunities/email/parse";
import { emailsOf, emailsToSort, suggestedPrice, type OpportunityEmail } from "@/lib/opportunities/email/view";
import { TriagePanel } from "./triage-panel";
import { TITLE_ONLY_NOTE } from "@/lib/opportunities/title-only";
import { FollowUpBox } from "./follow-up-box";
import { followUpDue } from "@/lib/opportunities/follow-up-due";

// « Coller une annonce » : Upwork d'abord (plus de flux RSS, l'annonce se copie à la main).
const EMPTY_FORM = { platform: "upwork" as Platform, url: "", title: "", body: "", budget: "", deadline: "" };

const BUDGET_PLACEHOLDER: Record<Platform, string> = {
  upwork: "ex. $500 fixed, ou $25–40/hr",
  codeur: "ex. 500 à 1 000 €",
  malt: "ex. 1 500 €, ou TJM 350 €",
  comeup: "ex. 120 €",
  autre: "ex. 500 €",
};

const scoreTone = (score: number | null) => (score == null ? "neutral" : score >= 8 ? "success" : score >= 5 ? "warning" : "danger");

// « À trier » (plateformes #3) : les e-mails de plateforme non reconnus, avec leurs trois actions.
// « Relances » (plateformes #6) : propositions envoyées sans réponse, à relancer.
type Filter = Bucket | "toutes" | "a_trier" | "relances";
const FILTERS: (Bucket | "toutes")[] = ["alertes", "a_voir", "ignorees", "toutes"];

/**
 * Opportunités : alertes de la veille Codeur en tête, filtres, fiche. Aucun
 * envoi : on ouvre l'annonce, on copie la proposition, on marque « envoyée ».
 * La fiche ouverte par la notification (`?id=`) passe en premier sur mobile.
 */
export function OpportunitiesClient({
  initial,
  emails: initialEmails = [],
  focusId,
  initialFilter,
}: {
  initial: Opportunity[];
  emails?: OpportunityEmail[];
  focusId?: string | null;
  initialFilter?: "relances" | "a_trier" | null;
}) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [emails, setEmails] = useState(initialEmails);
  const [platformFilter, setPlatformFilter] = useState<Platform | "toutes">("toutes");
  const toSort = useMemo(() => emailsToSort(emails), [emails]);
  const focused = focusId && initial.some((item) => item.id === focusId) ? focusId : null;
  const [selectedId, setSelectedId] = useState<string | null>(focused ?? initial[0]?.id ?? null);
  const [filter, setFilter] = useState<Filter>(initialFilter ?? (focused ? "toutes" : "alertes"));
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [fullText, setFullText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const alerts = useMemo(() => unseenAlerts(items), [items]);
  const counts = useMemo(() => {
    const result: Record<Bucket | "toutes", number> = { alertes: 0, a_voir: 0, ignorees: 0, toutes: items.length };
    for (const item of items) result[bucketOf(item)] += 1;
    return result;
  }, [items]);
  const shown = useMemo(
    () =>
      items.filter(
        (item) =>
          (filter === "toutes" || (filter === "relances" ? followUpDue(item) : bucketOf(item) === filter)) && (platformFilter === "toutes" || item.platform === platformFilter),
      ),
    [items, filter, platformFilter],
  );
  // Plateformes présentes : le filtre ne propose que celles qui ont des fiches.
  const platformsPresent = useMemo(() => PLATFORMS.filter((platform) => items.some((item) => item.platform === platform)), [items]);
  const dueCount = useMemo(() => items.filter((item) => followUpDue(item)).length, [items]);
  const selectedEmails = useMemo(() => (selectedId ? emailsOf(emails, selectedId) : []), [emails, selectedId]);

  /** E-mail « à trier » ignoré ou rattaché (rien n'est supprimé). */
  function emailChanged(id: string, patch: Partial<OpportunityEmail>) {
    setEmails((current) => current.map((email) => (email.id === id ? { ...email, ...patch } : email)));
  }

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

  async function patch(id: string, body: Record<string, unknown>, success: string | null): Promise<boolean> {
    setBusy(`patch:${id}`);
    try {
      const response = await fetch(`/api/opportunites/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { patch?: Partial<Opportunity>; error?: string };
      if (!response.ok || !result.patch) {
        toast.error(result.error ?? "Non enregistré.");
        return false;
      }
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...result.patch } : item)));
      if (success) toast.success(success);
      return true;
    } finally {
      setBusy(null);
    }
  }

  /** Alerte vue : sans attendre, sans toast. */
  function markSeen(item: Opportunity) {
    if (item.seen_at) return;
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, seen_at: new Date().toISOString() } : row)));
    void fetch(`/api/opportunites/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seen: true }) });
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

  /** Annonce complète collée : enregistrée, puis analyse et proposition refaites dessus. */
  async function regenerateFromFullText(id: string) {
    if (fullText.trim().length < 40) return toast.error("Collez le texte complet de l'annonce.");
    if (await patch(id, { body: fullText }, null)) {
      setFullText("");
      await regenerate(id);
    }
  }

  async function copy(item: Opportunity) {
    try {
      await navigator.clipboard.writeText(item.proposal ?? "");
      markSeen(item);
      toast.success("Proposition copiée : collez-la sur la plateforme.");
    } catch {
      toast.error("Copie impossible : sélectionnez le texte à la main.");
    }
  }

  const openAd = (item: Opportunity) => (
    <a
      href={item.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      onClick={() => markSeen(item)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-text hover:bg-surface-2",
        !item.url && "pointer-events-none opacity-50",
      )}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Ouvrir l&apos;annonce
    </a>
  );

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <ClipboardPaste className="h-4 w-4" aria-hidden /> Coller une annonce
        </Button>
      </div>

      {alerts.length > 0 && (
        <section className="mb-6 rounded-xl border border-good/25 bg-good/5 p-3">
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-medium text-text">
            <Bell className="h-4 w-4 text-good-ink" aria-hidden /> Nouvelles alertes <span className="font-data text-good-ink">{alerts.length}</span>
          </h2>
          <ul className="space-y-2">
            {alerts.map((item) => (
              <li key={item.id} className="rounded-lg border border-line-soft bg-surface p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(item.id)}>
                    <p className="text-[13px] font-medium text-text">{item.title}</p>
                    <p className="text-[12px] text-muted">
                      {PLATFORM_LABELS[item.platform]} · {ageLabel(item.published_at ?? item.created_at)}
                      {item.budget ? ` · ${item.budget}` : ""}
                    </p>
                  </button>
                  <Badge tone="success">{item.fit_score}/10</Badge>
                </div>
                <ul className="mt-1.5 list-disc pl-5 text-[12px] text-muted">
                  {(item.fit_reasons ?? []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  {openAd(item)}
                  <Button size="sm" disabled={!item.proposal} onClick={() => copy(item)}>
                    <Copy className="h-3.5 w-3.5" aria-hidden /> {item.proposal ? "Copier la proposition" : "Proposition en cours…"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {platformsPresent.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrer par plateforme">
          {(["toutes", ...platformsPresent] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={platformFilter === key}
              onClick={() => setPlatformFilter(key)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12px]",
                platformFilter === key ? "border-primary/30 bg-primary/10 text-primary-ink" : "border-line text-muted hover:bg-surface-2",
              )}
            >
              {key === "toutes" ? "Toutes plateformes" : PLATFORM_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrer les opportunités">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px]",
              filter === key ? "border-primary/30 bg-primary/10 text-primary-ink" : "border-line text-muted hover:bg-surface-2",
            )}
          >
            {BUCKET_LABELS[key]} <span className="font-data">{counts[key]}</span>
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={filter === "a_trier"}
          onClick={() => setFilter("a_trier")}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px]",
            filter === "a_trier" ? "border-primary/30 bg-primary/10 text-primary-ink" : "border-line text-muted hover:bg-surface-2",
          )}
        >
          <Inbox className="h-3.5 w-3.5" aria-hidden /> À trier <span className="font-data">{toSort.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "relances"}
          onClick={() => setFilter("relances")}
          className={cn(
            "rounded-full border px-3 py-1 text-[12px]",
            filter === "relances" ? "border-primary/30 bg-primary/10 text-primary-ink" : "border-line text-muted hover:bg-surface-2",
          )}
        >
          Relances dues <span className="font-data">{dueCount}</span>
        </button>
      </div>

      {filter === "a_trier" ? (
        <TriagePanel emails={toSort} opportunities={items} onChanged={emailChanged} onCreated={(id) => reload(id)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-6 w-6" aria-hidden />}
          title="Aucune opportunité"
          description="La veille Codeur et les e-mails Upwork, Malt et ComeUp les ajoutent tout seuls ; vous pouvez aussi coller une annonce (Upwork d'abord)."
          action={<Button onClick={() => setAdding(true)}>Coller une annonce</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card>
            <CardContent className="p-0">
              {shown.length === 0 ? (
                <p className="p-4 text-[13px] text-faint">{filter === "relances" ? "Aucune relance due : toutes les propositions envoyées ont une réponse ou sont récentes." : `Rien dans « ${BUCKET_LABELS[filter]} ».`}</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {shown.map((item) => (
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
                            {item.published_at ? ` · ${ageLabel(item.published_at)}` : ""}
                            {item.budget ? ` · ${item.budget}` : ""}
                            {item.filter_reason ? ` · filtre : ${item.filter_reason}` : ""}
                            {item.analysis_state === "pending" ? " · analyse en cours" : item.analysis_state === "a_analyser" ? " · à analyser" : item.analysis_state === "non_analysee" ? " · non analysée" : item.analysis_state === "titre_seul" ? " · titre seul" : ""}
                          </p>
                        </div>
                        {sizeFlag(item) && (
                          <span title={`${SIZE_BADGE} : ${sizeFlag(item)}`} className="shrink-0 rounded-full border border-warn/45 bg-warn/15 px-2 py-0.5 text-[11px] text-warn-ink">
                            Trop gros seul
                          </span>
                        )}
                        {item.fit_score != null && item.analysis_state !== "titre_seul" && <Badge tone={scoreTone(item.fit_score)}>{item.fit_score}/10</Badge>}
                        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{STATUS_LABELS[item.status]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {selected && (
            // Ouverte depuis la notification : la fiche passe AVANT la liste sur mobile.
            <Card className={cn(focused === selected.id && "order-first lg:order-none")}>
              <CardContent className="space-y-4 p-4">
                <div>
                  <p className="text-[12px] text-faint">
                    {PLATFORM_LABELS[selected.platform]}
                    {selected.client_name ? ` · ${selected.client_name}` : ""}
                    {selected.published_at ? ` · ${ageLabel(selected.published_at)}` : ""}
                    {selected.budget ? ` · ${selected.budget}` : ""}
                    {selected.source === "email" ? " · reçue par e-mail" : ""}
                  </p>
                  <h2 className="font-display text-lg text-text">{selected.title}</h2>
                  {staleLabel(selected.published_at) && <p className="mt-1 text-[12px] text-warn-ink">{staleLabel(selected.published_at)}</p>}
                  {sizeFlag(selected) && (
                    <p className="mt-1.5 inline-flex rounded-full border border-warn/45 bg-warn/15 px-2.5 py-0.5 text-[12px] text-warn-ink">
                      {SIZE_BADGE} ({sizeFlag(selected)})
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.url && openAd(selected)}
                    {selected.proposal && (
                      <Button size="sm" onClick={() => copy(selected)}>
                        <Copy className="h-3.5 w-3.5" aria-hidden /> Copier la proposition
                      </Button>
                    )}
                  </div>
                </div>

                {selected.filter_reason ? (
                  <p className="rounded-lg border border-line-soft bg-surface-2/60 p-3 text-[13px] text-muted">
                    Écartée par le filtre, sans analyse : {selected.filter_reason}.
                    <Button size="sm" variant="ghost" className="ml-2" loading={busy === `regen:${selected.id}`} onClick={() => regenerate(selected.id)}>
                      Analyser quand même
                    </Button>
                  </p>
                ) : selected.analysis_state === "titre_seul" ? (
                  // Alerte Codeur à titre seul (plateformes #11) : pas de score, l'annonce collée lancera l'analyse.
                  <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-[13px] text-text">
                    <p>{TITLE_ONLY_NOTE}.</p>
                    {selected.url && <div className="mt-2">{openAd(selected)}</div>}
                  </div>
                ) : selected.fit_score == null ? (
                  <div className="flex items-center gap-2 text-[13px] text-muted">
                    {selected.analysis_state === "pending" ? "Analyse en cours." : selected.analysis_state === "a_analyser" ? "Plafond d'analyses du jour atteint." : selected.analysis_state === "non_analysee" ? "Non analysée : crédit OpenAI épuisé." : "Analyse absente."}
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
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <Label>Proposition</Label>
                      <div className="flex items-center gap-1.5">
                        {selected.proposal_on_excerpt && (
                          <span title="Rédigée sur l'extrait du flux RSS : collez l'annonce complète pour la régénérer." className="rounded-full border border-warn/25 bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn-ink">
                            Brouillon sur extrait
                          </span>
                        )}
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
                    </div>
                    {selected.proposal_reason && <p className="mb-1.5 text-[12px] text-warn-ink">À retravailler — {selected.proposal_reason}</p>}
                    <Textarea
                      key={`${selected.id}:${selected.updated_at}`}
                      defaultValue={selected.proposal}
                      rows={12}
                      onBlur={(event) => {
                        if (event.target.value.trim() !== selected.proposal?.trim()) void patch(selected.id, { proposal: event.target.value }, "Proposition enregistrée.");
                      }}
                    />
                    <p className={cn("mt-1 font-data text-[11px]", selected.platform === "upwork" && (selected.proposal ?? "").length > 1200 ? "text-lost-ink" : "text-faint")}>
                      {(selected.proposal ?? "").length} caractères{selected.platform === "upwork" ? " / 1 200 (Upwork : la 1re phrase s'affiche en aperçu)" : ""}
                    </p>
                    {(selected.suggested_amount_eur != null || selected.suggested_delay_days != null) && (
                      <p className="mt-1.5 text-[13px] text-text">
                        À saisir sur {PLATFORM_LABELS[selected.platform]} :{" "}
                        <span className="font-data">{suggestedPrice(selected.suggested_amount_eur, selected.suggested_currency ?? (selected.platform === "upwork" ? "USD" : "EUR"), selected.suggested_hourly)}</span> ·{" "}
                        <span className="font-data">{selected.suggested_delay_days != null ? `${selected.suggested_delay_days} jours` : "—"}</span>
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
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

                {followUpDue(selected) && (
                  <FollowUpBox item={selected} onPatched={(patch) => setItems((current) => current.map((item) => (item.id === selected.id ? { ...item, ...patch } : item)))} />
                )}

                {selected.description_truncated && (
                  <div className="rounded-lg border border-warn/25 bg-warn/5 p-3">
                    <Label htmlFor="full-text">Coller l&apos;annonce complète</Label>
                    <p className="mb-1.5 text-[12px] text-muted">Le flux ne donne qu&apos;un extrait : collez le texte complet depuis Codeur, puis régénérez.</p>
                    <Textarea id="full-text" rows={5} value={fullText} onChange={(event) => setFullText(event.target.value)} />
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" loading={busy === `regen:${selected.id}` || busy === `patch:${selected.id}`} onClick={() => regenerateFromFullText(selected.id)}>
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
                {selectedEmails.length > 0 && (
                  <div>
                    <Label>Suivi par e-mail</Label>
                    <ul className="mt-1 space-y-1">
                      {selectedEmails.map((email) => (
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
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Coller une annonce"
        description="Texte, lien et budget de l'annonce, pour toute plateforme : l'analyse et la proposition prennent une trentaine de secondes. Rien n'est envoyé."
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
            <Label htmlFor="new-title">Titre (facultatif)</Label>
            <Input id="new-title" value={form.title} placeholder="sinon, la première ligne de l'annonce" onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="new-body">Texte de l&apos;annonce</Label>
            <Textarea id="new-body" rows={8} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} />
          </div>
          <div>
            <Label htmlFor="new-budget">Budget</Label>
            <Input id="new-budget" value={form.budget} placeholder={BUDGET_PLACEHOLDER[form.platform]} onChange={(event) => setForm({ ...form, budget: event.target.value })} />
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
