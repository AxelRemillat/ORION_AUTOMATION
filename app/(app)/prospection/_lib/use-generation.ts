"use client";

import { useState } from "react";
import { useToast } from "@/components/ui";
import { postJson } from "@/lib/enrichment/api-client";
import type { BriefAngle, StrategyBrief } from "@/lib/emails/strategist";
import type { Prospect } from "@/types";
import type { ToneKey } from "./tones";
import type { GenerateResponse } from "../types";

type Draft = { subject: string; body: string };

/**
 * Les trois façons de (re)générer un brouillon.
 *
 *   full        : chaîne complète — contact Hunter, stratège, rédacteur, juge.
 *   other_angle : stratège seul (angles déjà vus exclus), puis rédaction.
 *   rewrite     : rédacteur seul, depuis le brief édité à la main.
 *
 * Seul `full` peut consommer des crédits Hunter : les deux autres renvoient
 * le contact déjà trouvé.
 */
export function useGeneration(tone: ToneKey) {
  const toast = useToast();
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({ subject: "", body: "" });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Angles déjà proposés pour ce prospect : « Autre angle » les fait tourner. */
  const [seenAngles, setSeenAngles] = useState<BriefAngle[]>([]);

  function reset() {
    setResult(null);
    setDraft({ subject: "", body: "" });
    setError(null);
    setSeenAngles([]);
  }

  async function run(prospect: Prospect, payload: Record<string, unknown>) {
    setGenerating(true);
    setError(null);
    try {
      const data = await postJson<GenerateResponse>("/api/emails/generate", {
        prospectId: prospect.id,
        tone,
        ...payload,
      });
      setResult(data);
      setDraft(data.email);
      data.warnings.forEach((warning) => toast.toast(`${warning.source} : ${warning.message}`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Génération impossible.");
    } finally {
      setGenerating(false);
    }
  }

  const generate = (prospect: Prospect) => {
    setSeenAngles([]);
    return run(prospect, { mode: "full" });
  };

  const otherAngle = (prospect: Prospect) => {
    if (!result) return;
    const excludeAngles = [...seenAngles, result.brief.angle];
    setSeenAngles(excludeAngles);
    return run(prospect, { mode: "other_angle", cachedContact: result.contact, excludeAngles });
  };

  const rewrite = (prospect: Prospect, brief: StrategyBrief) =>
    run(prospect, {
      mode: "rewrite",
      cachedContact: result?.contact ?? null,
      brief,
      excludeAngles: seenAngles,
    });

  return { result, draft, setDraft, generating, error, reset, generate, otherAngle, rewrite };
}
