"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/lib/enrichment/api-client";
import { startJob, watchJob } from "@/lib/jobs/client";
import { useToast } from "@/components/ui";

/**
 * Ré-enrichir une fiche existante, depuis l'écran.
 *
 * Le job `reanalyze` existait — il rejoue toute la chaîne d'enrichissement, y
 * compris l'appel Pappers qui rapporte les établissements et leurs dates — mais
 * AUCUN écran ne le créait. Conséquence en production : une fiche enrichie avant
 * une amélioration restait dans son ancien état pour toujours, et le bouton
 * « Relancer l'analyse » n'y changeait rien (il ne relance que la rédaction).
 *
 * SELECTION HABITAT en est l'exemple : ses quatre ouvertures d'agences de moins
 * d'un an étaient trouvables chez Pappers, absentes de la fiche, et la
 * génération répondait « à nourrir ».
 */
export function useReanalyze(onDone: () => void) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const toast = useToast();
  // Le suivi s'arrête si l'écran change de prospect ; le job, lui, continue.
  const abandoned = useRef(false);

  const reanalyze = useCallback(
    async (prospect: { id: string; company_name: string }) => {
      if (running) return;
      setRunning(true);
      setStep("Réanalyse de la fiche");
      abandoned.current = false;

      try {
        const id = await startJob(
          "reanalyze",
          { prospectId: prospect.id, label: `Réanalyse · ${prospect.company_name}`.slice(0, 160) },
          { prospectId: prospect.id },
        );
        const snapshot = await watchJob(id, {
          onUpdate: (job) => setStep(typeof job.progress?.step === "string" ? job.progress.step : null),
          stopped: () => abandoned.current,
        });

        if (!snapshot) return;
        if (snapshot.job.status !== "done") {
          toast.error(snapshot.job.error ?? "Réanalyse en échec.");
          return;
        }
        toast.success("Fiche réanalysée : signaux et chiffres clés à jour.");
        onDone();
      } catch (cause) {
        toast.error(cause instanceof ApiError ? cause.message : "Réanalyse impossible.");
      } finally {
        setRunning(false);
        setStep(null);
      }
    },
    [onDone, running, toast],
  );

  const abandon = useCallback(() => {
    abandoned.current = true;
  }, []);

  return { reanalyze, abandon, running, step };
}
