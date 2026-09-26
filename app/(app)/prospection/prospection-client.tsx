"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MousePointerClick } from "lucide-react";
import { EmptyState, Skeleton, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Prospect } from "@/types";
import { AnalysisPanel } from "./analysis-panel";
import { EmailEditor } from "./email-editor";
import { ChosenAngle } from "./_components/chosen-angle";
import { DraftPreview } from "./_components/draft-preview";
import { ErrorBanner } from "./_components/error-banner";
import { SequenceShell } from "./_components/sequence-shell";
import { DEFAULT_TONE, type ToneKey } from "./_lib/tones";
import { useGeneration } from "./_lib/use-generation";
import type { SequenceStep } from "./_lib/sequence";
import { ProspectHeader } from "./prospect-header";
import { ProspectPicker } from "./prospect-picker";
import type { UserOffer } from "@/types";
import { OfferBanner } from "./_components/offer-banner";
import { FeedingBanner } from "./_components/feeding-banner";
import { GenerationProgress } from "./_components/generation-progress";

/**
 * Écran de prospection : sélection d'un prospect → analyse IA chiffrée →
 * brouillon relu puis validé. La validation écrit un `message` (type 'intro',
 * status 'draft') et fait passer le prospect à 'a_contacter'.
 */
export function ProspectionClient({
  initialProspects,
  sequences,
  offer,
  offerComplete,
}: {
  initialProspects: Prospect[];
  sequences: Record<string, SequenceStep[]>;
  /** Ce qu'Axel vend : signature, preuves, demande d'entrée. */
  offer: UserOffer;
  /** `false` tant que /offre n'est pas remplie : les mails restent impersonnels. */
  offerComplete: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [prospects, setProspects] = useState(initialProspects);
  // La liste suit le serveur : une mise à la corbeille (ou son annulation)
  // rafraîchit la page, et donc ces props.
  useEffect(() => setProspects(initialProspects), [initialProspects]);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [tone, setTone] = useState<ToneKey>(DEFAULT_TONE);
  const [saving, setSaving] = useState(false);
  const {
    result: analysis,
    draft,
    setDraft,
    generating,
    progress,
    error,
    needsFeeding,
    messageId,
    load,
    generate,
    generateAnyway,
    otherAngle,
    rewrite,
  } =
    useGeneration(tone);

  /** Choisir un prospect recharge son dernier brouillon, ou reprend sa génération. */
  function select(prospect: Prospect) {
    setSelected(prospect);
    void load(prospect);
  }

  // Lien de la navbar (« /prospection?prospect=… ») : on rouvre ce prospect.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("prospect");
    const target = id ? initialProspects.find((item) => item.id === id) : null;
    if (target) select(target);
    // Au premier rendu seulement : ensuite, c'est la liste qui décide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Enregistre le brouillon relu et avance le prospect dans le pipeline. */
  async function validate() {
    if (!selected || !analysis) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const content = { subject: draft.subject.trim() || null, body: draft.body.trim() };
      // Le job a déjà posé le brouillon en base : on le met à jour plutôt que
      // d'en créer un second.
      const { error: messageError } = messageId
        ? await supabase.from("messages").update(content).eq("id", messageId)
        : await supabase.from("messages").insert({ prospect_id: selected.id, type: "intro", status: "draft", ...content });
      if (messageError) throw new Error(messageError.message);

      const { error: prospectError } = await supabase
        .from("prospects")
        .update({ status: "a_contacter", pain_point: analysis.pain_point })
        .eq("id", selected.id);
      if (prospectError) throw new Error(prospectError.message);

      const updated: Prospect = {
        ...selected,
        status: "a_contacter",
        pain_point: analysis.pain_point,
      };
      setSelected(updated);
      setProspects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Brouillon enregistré. Le prospect passe à « À contacter ».");
      router.refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sans offre remplie, le mail ne dit ni qui ecrit ni ce qu'on propose. */}
      {!offerComplete && <OfferBanner />}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <ProspectPicker
        prospects={prospects}
        selectedId={selected?.id ?? null}
        onSelect={select}
        onTrashed={(id) => {
          if (selected?.id === id) setSelected(null);
        }}
      />

      {!selected ? (
        <EmptyState
          icon={<MousePointerClick />}
          title="Choisissez un prospect"
          description="Sélectionnez une entreprise à gauche pour lancer l'analyse et préparer son email d'approche."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ProspectHeader
            prospect={selected}
            loading={generating}
            hasAnalysis={Boolean(analysis)}
            tone={tone}
            onToneChange={setTone}
            onGenerate={() => generate(selected)}
          />

          <SequenceShell steps={sequences[selected.id] ?? []} />

          {error && <ErrorBanner message={error} />}
          {/* Manque de matiere, pas une panne : on propose de forcer. */}
          {needsFeeding && selected && (
            <FeedingBanner
              message={needsFeeding}
              loading={generating}
              onForce={() => generateAnyway(selected)}
            />
          )}

          {generating && <GenerationProgress progress={progress} />}
          {generating && !analysis && <Skeleton className="h-72" />}

          {analysis && (
            <>
              <AnalysisPanel
                painPoint={analysis.pain_point}
                evidence={analysis.evidence}
                contact={analysis.contact}
                needLead={analysis.needLead}
              />

              <div className="grid gap-4 xl:grid-cols-2">
                <EmailEditor
                  subject={draft.subject}
                  body={draft.body}
                  saving={saving}
                  regenerating={generating}
                  onChange={setDraft}
                  onValidate={validate}
                  onRegenerate={() => generate(selected)}
                />
                <DraftPreview
                  subject={draft.subject}
                  body={draft.body}
                  to={analysis.contact?.email ?? selected.email}
                />
              </div>

              {/* Sous le brouillon : l'angle retenu, et de quoi en changer. */}
              <ChosenAngle
                  offer={offer}
                key={JSON.stringify(analysis.brief.angle) + analysis.brief.pain.task}
                brief={analysis.brief}
                regenerating={generating}
                onOtherAngle={() => otherAngle(selected)}
                onRewrite={(brief) => rewrite(selected, brief)}
              />
            </>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
