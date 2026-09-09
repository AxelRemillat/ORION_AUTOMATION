"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MousePointerClick } from "lucide-react";
import { EmptyState, Skeleton, useToast } from "@/components/ui";
import { postJson } from "@/lib/enrichment/api-client";
import { createClient } from "@/lib/supabase/client";
import type { Prospect } from "@/types";
import { AnalysisPanel } from "./analysis-panel";
import { EmailEditor } from "./email-editor";
import { DraftPreview } from "./_components/draft-preview";
import { ErrorBanner } from "./_components/error-banner";
import { SequenceShell } from "./_components/sequence-shell";
import { DEFAULT_TONE, type ToneKey } from "./_lib/tones";
import type { SequenceStep } from "./_lib/sequence";
import { ProspectHeader } from "./prospect-header";
import { ProspectPicker } from "./prospect-picker";
import type { GenerateResponse } from "./types";

type Draft = { subject: string; body: string };

/**
 * Écran de prospection : sélection d'un prospect → analyse IA chiffrée →
 * brouillon relu puis validé. La validation écrit un `message` (type 'intro',
 * status 'draft') et fait passer le prospect à 'a_contacter'.
 */
export function ProspectionClient({
  initialProspects,
  sequences,
}: {
  initialProspects: Prospect[];
  sequences: Record<string, SequenceStep[]>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [prospects, setProspects] = useState(initialProspects);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [tone, setTone] = useState<ToneKey>(DEFAULT_TONE);
  const [analysis, setAnalysis] = useState<GenerateResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({ subject: "", body: "" });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function select(prospect: Prospect) {
    setSelected(prospect);
    setAnalysis(null);
    setDraft({ subject: "", body: "" });
    setError(null);
  }

  async function generate(prospect: Prospect) {
    setGenerating(true);
    setError(null);
    try {
      // `tone` est déjà transmis : la route l'ignore aujourd'hui (cf. _lib/tones.ts).
      const data = await postJson<GenerateResponse>("/api/emails/generate", {
        prospectId: prospect.id,
        tone,
      });
      setAnalysis(data);
      setDraft(data.email);
      data.warnings.forEach((warning) => toast.toast(`${warning.source} : ${warning.message}`));
    } catch (cause) {
      setAnalysis(null);
      setError(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally {
      setGenerating(false);
    }
  }

  /** Enregistre le brouillon relu et avance le prospect dans le pipeline. */
  async function validate() {
    if (!selected || !analysis) return;
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: messageError } = await supabase.from("messages").insert({
        prospect_id: selected.id,
        type: "intro",
        subject: draft.subject.trim() || null,
        body: draft.body.trim(),
        status: "draft",
      });
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
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <ProspectPicker prospects={prospects} selectedId={selected?.id ?? null} onSelect={select} />

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

          {generating && !analysis && (
            <>
              <Skeleton className="h-24" />
              <Skeleton className="h-72" />
            </>
          )}

          {analysis && (
            <>
              <AnalysisPanel
                painPoint={analysis.pain_point}
                levers={analysis.levers}
                contact={analysis.contact}
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
