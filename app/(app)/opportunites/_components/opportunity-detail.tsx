import { Copy, RefreshCw } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { cn } from "@/lib/utils";
import { PLATFORM_LABELS, type Opportunity } from "@/lib/opportunities/types";
import { ageLabel, SIZE_BADGE, sizeFlag, staleLabel } from "@/lib/opportunities/view";
import { TITLE_ONLY_NOTE } from "@/lib/opportunities/title-only";
import { followUpDue } from "@/lib/opportunities/follow-up-due";
import type { OpportunityEmail } from "@/lib/opportunities/email/view";
import { OpenAdLink } from "./open-ad-link";
import { LaneBadges } from "./lane-badges";
import { CMS_NOTE } from "@/lib/opportunities/lane";
import { rowLane } from "@/lib/opportunities/view";
import { ProposalSection } from "./proposal-section";
import { DetailFields } from "./detail-fields";
import { FollowUpBox } from "./follow-up-box";
import type { OpportunityActions } from "./use-opportunity-actions";

const PENDING_LABELS: Record<string, string> = { pending: "Analyse en cours.", a_analyser: "Plafond d'analyses du jour atteint.", non_analysee: "Non analysée : crédit OpenAI épuisé." };

/** Fiche d'une opportunité. Ouverte depuis la notification (`focused`), elle passe AVANT la liste sur mobile. */
export function OpportunityDetail({ selected, focused, emails, actions }: { selected: Opportunity; focused: boolean; emails: OpportunityEmail[]; actions: OpportunityActions }) {
  const { busy, regenerate, markSeen, copy } = actions;
  const analyzeBusy = busy === `regen:${selected.id}`;
  return (
    <Card className={cn(focused && "order-first lg:order-none")}>
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
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <LaneBadges item={selected} />
          </div>
          {!selected.filter_reason && rowLane(selected) === "cms_impose" && <p className="mt-1 text-[12px] text-warn-ink">{CMS_NOTE}.</p>}
          {staleLabel(selected.published_at) && <p className="mt-1 text-[12px] text-warn-ink">{staleLabel(selected.published_at)}</p>}
          {sizeFlag(selected) && (
            <p className="mt-1.5 inline-flex rounded-full border border-warn/45 bg-warn/15 px-2.5 py-0.5 text-[12px] text-warn-ink">
              {SIZE_BADGE} ({sizeFlag(selected)})
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.url && <OpenAdLink item={selected} onOpen={markSeen} />}
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
            <Button size="sm" variant="ghost" className="ml-2" loading={analyzeBusy} onClick={() => regenerate(selected.id)}>
              Analyser quand même
            </Button>
          </p>
        ) : selected.analysis_state === "titre_seul" ? (
          // Alerte Codeur à titre seul (plateformes #11) : pas de score, l'annonce collée lancera l'analyse.
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-[13px] text-text">
            <p>{TITLE_ONLY_NOTE}.</p>
            {selected.url && (
              <div className="mt-2">
                <OpenAdLink item={selected} onOpen={markSeen} />
              </div>
            )}
          </div>
        ) : selected.fit_score == null ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            {PENDING_LABELS[selected.analysis_state ?? ""] ?? "Analyse absente."}
            <Button size="sm" variant="outline" loading={analyzeBusy} onClick={() => regenerate(selected.id)}>
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

        {selected.proposal && <ProposalSection selected={selected} actions={actions} />}

        {followUpDue(selected) && <FollowUpBox item={selected} onPatched={(patch) => actions.merge(selected.id, patch)} />}

        <DetailFields selected={selected} emails={emails} actions={actions} />
      </CardContent>
    </Card>
  );
}
