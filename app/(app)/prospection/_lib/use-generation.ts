"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui";
import { fetchJob, fetchProspectJobs, isActive, startJob, watchJob, type JobSnapshot } from "@/lib/jobs/client";
import type { JobProgress } from "@/lib/jobs/types";
import type { BriefAngle, StrategyBrief } from "@/lib/emails/strategist";
import type { Prospect } from "@/types";
import type { ToneKey } from "./tones";
import type { GenerateResponse } from "../types";
import { loadDraft, saveDraftSoon } from "./draft-store";

type Draft = { subject: string; body: string };

/**
 * Génération d'un brouillon, en TÂCHE DE FOND (table `jobs`).
 *
 *   full        : chaîne complète — contact Hunter, stratège, rédacteur, juge.
 *   other_angle : stratège seul (angles déjà vus exclus), puis rédaction.
 *   rewrite     : rédacteur seul, depuis le brief édité à la main.
 *
 * Le serveur écrit le brief puis le brouillon en base au fil des étapes. Quitter
 * la page ne perd rien : au retour sur le prospect, `load` reprend le suivi
 * d'une génération en cours, ou réaffiche la dernière terminée.
 */
export function useGeneration(tone: ToneKey) {
  const toast = useToast();
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [draft, setDraftState] = useState<Draft>({ subject: "", body: "" });
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Fiche sans accroche forte : on propose « Générer quand même ». */
  const [needsFeeding, setNeedsFeeding] = useState<string | null>(null);
  /** Angles déjà proposés pour ce prospect : « Autre angle » les fait tourner. */
  const [seenAngles, setSeenAngles] = useState<BriefAngle[]>([]);
  /** Brouillon enregistré en base par le job : les retouches y sont écrites. */
  const [messageId, setMessageId] = useState<string | null>(null);
  /** Change à chaque prospect : un suivi d'un autre prospect s'arrête net. */
  const watching = useRef(0);

  useEffect(() => () => void (watching.current += 1), []);

  function clear() {
    watching.current += 1;
    setResult(null);
    setDraftState({ subject: "", body: "" });
    setGenerating(false);
    setProgress(null);
    setError(null);
    setNeedsFeeding(null);
    setSeenAngles([]);
    setMessageId(null);
  }

  /** Affiche un job terminé : brouillon, brief, ou la raison de l'échec. */
  async function show(snapshot: JobSnapshot<GenerateResponse>, announce: boolean) {
    const { job, output, details } = snapshot;
    if (job.status === "done" && output) {
      const id = job.result?.messageId ?? null;
      setResult(output);
      setMessageId(id);
      // Le brouillon en base fait foi : il porte les retouches déjà faites.
      setDraftState((id && (await loadDraft(id))) || output.email);
      if (announce) output.warnings.forEach((w) => toast.toast(`${w.source} : ${w.message}`));
    } else if (job.status === "failed") {
      if (details?.canForce) setNeedsFeeding(job.error ?? "Accroche insuffisante.");
      else setError(job.error ?? "Génération impossible.");
    } else if (job.status === "cancelled") {
      setError("Génération annulée.");
    }
  }

  async function follow(jobId: string) {
    const ticket = ++watching.current;
    const stopped = () => watching.current !== ticket;
    setGenerating(true);
    try {
      const final = await watchJob<GenerateResponse>(jobId, { stopped, onUpdate: (job) => setProgress(job.progress) });
      if (final && !stopped()) await show(final, true);
    } catch (cause) {
      if (!stopped()) setError(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally {
      if (!stopped()) {
        setGenerating(false);
        setProgress(null);
      }
    }
  }

  /** Retour sur un prospect : reprise d'une génération en cours, ou dernier brouillon. */
  async function load(prospect: Prospect) {
    clear();
    const ticket = watching.current;
    const jobs = await fetchProspectJobs(prospect.id).catch(() => []);
    const latest = jobs[0];
    if (!latest || watching.current !== ticket) return;
    if (isActive(latest)) return follow(latest.id);
    const snapshot = await fetchJob<GenerateResponse>(latest.id).catch(() => null);
    if (snapshot && watching.current === ticket && snapshot.job.status === "done") await show(snapshot, false);
  }

  async function run(prospect: Prospect, payload: Record<string, unknown>) {
    setError(null);
    setNeedsFeeding(null);
    setGenerating(true);
    setProgress(null);
    try {
      const jobId = await startJob(
        payload.mode === "rewrite" ? "email_rewrite" : "email_generate",
        { prospectId: prospect.id, label: `Mail · ${prospect.company_name}`.slice(0, 160) },
        { prospectId: prospect.id, tone, ...payload, saveDraft: true, replaceMessageId: messageId },
      );
      await follow(jobId);
    } catch (cause) {
      setGenerating(false);
      setError(cause instanceof Error ? cause.message : "Génération impossible.");
    }
  }

  /** Retouche du brouillon : affichée tout de suite, écrite en base peu après. */
  function setDraft(next: Draft) {
    setDraftState(next);
    if (messageId) saveDraftSoon(messageId, next);
  }

  const generate = (prospect: Prospect) => {
    setSeenAngles([]);
    return run(prospect, { mode: "full" });
  };

  /** « Générer quand même » : le brouillon sortira marqué « générique ». */
  const generateAnyway = (prospect: Prospect) => {
    setSeenAngles([]);
    return run(prospect, { mode: "full", force: true });
  };

  const otherAngle = (prospect: Prospect) => {
    if (!result) return;
    const excludeAngles = [...seenAngles, result.brief.angle];
    setSeenAngles(excludeAngles);
    return run(prospect, { mode: "other_angle", cachedContact: result.contact, excludeAngles });
  };

  const rewrite = (prospect: Prospect, brief: StrategyBrief) =>
    run(prospect, { mode: "rewrite", cachedContact: result?.contact ?? null, brief, excludeAngles: seenAngles });

  return {
    result,
    draft,
    setDraft,
    generating,
    progress,
    error,
    needsFeeding,
    messageId,
    load,
    reset: clear,
    generate,
    generateAnyway,
    otherAngle,
    rewrite,
  };
}
