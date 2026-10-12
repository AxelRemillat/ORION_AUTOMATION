"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui";
import type { Opportunity } from "@/lib/opportunities/types";
import { bucketOf, rowsOfBucket, seenAlerts, unseenAlerts, type Bucket } from "@/lib/opportunities/view";
import { PLATFORM_IDENTITIES } from "@/lib/opportunities/platform-style";
import { emailsOf, emailsToSort, type OpportunityEmail } from "@/lib/opportunities/email/view";
import { followUpDue } from "@/lib/opportunities/follow-up-due";
import { bucketFilters, emailsOfTab, formPlatform, itemsOfTab, tabBadges, tabHref, visibleTabs, type Filter, type PlatformTab } from "@/lib/opportunities/tabs";
import { useOpportunityActions } from "./use-opportunity-actions";
import { PlatformTabs } from "./platform-tabs";
import { FilterBar } from "./filter-bar";
import { AlertsPanel } from "./alerts-panel";
import { OpportunityList } from "./opportunity-list";
import { OpportunityDetail } from "./opportunity-detail";
import { PasteInline, PasteModal } from "./paste-form";
import { TabEmptyState } from "./tab-empty-state";
import { TriagePanel } from "./triage-panel";
import { PlatformBanner } from "./platform-banner";
import { SeenAlerts } from "./seen-alerts";

/** Fiche ouverte par défaut : la première du filtre affiché, sinon la première de l'onglet. */
const firstOf = (items: Opportunity[], filter: Filter) =>
  (items.find((item) => filter === "toutes" || (filter === "relances" ? followUpDue(item) : filter !== "a_trier" && bucketOf(item) === filter)) ?? items[0])?.id ?? null;

/**
 * Opportunités, un onglet par plateforme (Cowork #19) : Codeur (veille RSS),
 * Upwork (annonces collées), ComeUp (commandes par e-mail), « Autres » s'il y a
 * des fiches Malt ou autres. Aucun envoi. La fiche ouverte par la notification
 * (`?id=`) choisit l'onglet et passe en premier sur mobile.
 */
export function OpportunitiesClient({
  initial,
  emails: initialEmails = [],
  focusId,
  initialTab,
  initialFilter,
}: {
  initial: Opportunity[];
  emails?: OpportunityEmail[];
  focusId?: string | null;
  initialTab: PlatformTab;
  initialFilter?: "relances" | "a_trier" | null;
}) {
  const [items, setItems] = useState(initial);
  const [emails, setEmails] = useState(initialEmails);
  // Rafraîchissement automatique (Cowork #23) : les nouvelles données du serveur remplacent la liste.
  useEffect(() => setItems(initial), [initial]);
  useEffect(() => setEmails(initialEmails), [initialEmails]);
  const [tab, setTab] = useState<PlatformTab>(initialTab);
  const focused = focusId && initial.some((item) => item.id === focusId) ? focusId : null;
  const [filter, setFilter] = useState<Filter>(initialFilter ?? (focused ? "toutes" : "alertes"));
  const [selectedId, setSelectedId] = useState<string | null>(() => focused ?? firstOf(itemsOfTab(initial, initialTab), filter));
  // Upwork : formulaire ouvert par défaut (pas de flux) ; ailleurs, fenêtre au clic.
  const [pasting, setPasting] = useState(initialTab === "upwork");
  const actions = useOpportunityActions(setItems, tab);

  const tabs = useMemo(() => visibleTabs(items), [items]);
  const badges = useMemo(() => tabBadges(items), [items]);
  const tabItems = useMemo(() => itemsOfTab(items, tab), [items, tab]);
  const toSort = useMemo(() => emailsOfTab(emailsToSort(emails), tab), [emails, tab]);
  const alerts = useMemo(() => unseenAlerts(tabItems), [tabItems]);
  const seen = useMemo(() => seenAlerts(tabItems), [tabItems]);
  // Fermées et annonces de plus de 7 jours : hors « Alertes » et « À voir », seulement dans « Toutes » (Cowork #21).
  const counts = useMemo(() => {
    const keys: (Bucket | "toutes")[] = ["alertes", "a_voir", "ignorees", "toutes"];
    return Object.fromEntries(keys.map((key) => [key, rowsOfBucket(tabItems, key).length])) as Record<Bucket | "toutes", number>;
  }, [tabItems]);
  const shown = useMemo(() => (filter === "relances" ? tabItems.filter((item) => followUpDue(item)) : filter === "a_trier" ? [] : rowsOfBucket(tabItems, filter)), [tabItems, filter]);
  const dueCount = useMemo(() => tabItems.filter((item) => followUpDue(item)).length, [tabItems]);
  const selected = tabItems.find((item) => item.id === selectedId) ?? null;
  const selectedEmails = useMemo(() => (selected ? emailsOf(emails, selected.id) : []), [emails, selected]);

  function selectTab(next: PlatformTab) {
    setTab(next);
    setFilter("alertes");
    setSelectedId(firstOf(itemsOfTab(items, next), "alertes"));
    setPasting(next === "upwork");
    window.history.replaceState(null, "", tabHref(next));
  }

  const pasteLabel = tab === "comeup" ? "Coller une demande" : "Coller une annonce";
  const pasteProps = { platform: formPlatform(tab), busy: actions.busy === "create", onSubmit: actions.create, onCancel: () => setPasting(false) };

  return (
    <div className={PLATFORM_IDENTITIES[tab].theme}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <PlatformTabs tabs={tabs} active={tab} badges={badges} onSelect={selectTab} />
        <Button className="mb-4" onClick={() => setPasting(true)}>
          <ClipboardPaste className="h-4 w-4" aria-hidden /> {pasteLabel}
        </Button>
      </div>

      <PlatformBanner tab={tab} />
      {tab === "upwork" && pasting && <PasteInline key="upwork" {...pasteProps} />}
      <AlertsPanel alerts={alerts} actions={actions} onSelect={setSelectedId} />

      {(tabItems.length > 0 || toSort.length > 0) && (
        <FilterBar filters={bucketFilters(tab, tabItems)} counts={counts} toSortCount={toSort.length} dueCount={dueCount} active={filter} onSelect={setFilter} />
      )}

      {filter === "a_trier" ? (
        <TriagePanel
          emails={toSort}
          opportunities={items}
          onChanged={(id, patch) => setEmails((current) => current.map((email) => (email.id === id ? { ...email, ...patch } : email)))}
          onCreated={(id) => actions.reload(id)}
        />
      ) : tabItems.length === 0 ? (
        <TabEmptyState tab={tab} onPaste={() => setPasting(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-3">
            <OpportunityList shown={shown} filter={filter} tab={tab} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
            <SeenAlerts alerts={seen} onSelect={setSelectedId} />
          </div>
          {selected && <OpportunityDetail key={selected.id} selected={selected} focused={focused === selected.id} emails={selectedEmails} actions={actions} />}
        </div>
      )}

      {tab !== "upwork" && <PasteModal key={tab} open={pasting} title={pasteLabel} {...pasteProps} />}
    </div>
  );
}
