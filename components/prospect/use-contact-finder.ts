"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startJob, watchJob } from "@/lib/jobs/client";
import type { Prospect } from "@/types";

/** Ce que la fiche affiche du contact : lu en base, pas déduit à l'écran. */
export type ContactFields = Pick<
  Prospect,
  "website" | "email" | "email_type" | "email_source_url" | "contact_confidence" | "contact_found_by" | "contact_checked_at"
>;

const COLUMNS = "website, email, email_type, email_source_url, contact_confidence, contact_found_by, contact_checked_at";

/**
 * Lance le module contact en tâche de fond (job `reanalyze`, scope contact)
 * et relit la fiche à la fin. Quitter l'écran ne coupe rien : le job continue.
 */
export function useContactFinder(prospect: Pick<Prospect, "id" | "company_name"> & ContactFields) {
  const [fields, setFields] = useState<ContactFields>(prospect);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gone = useRef(false);

  useEffect(() => {
    gone.current = false;
    setFields(prospect);
    return () => {
      gone.current = true;
    };
    // Une autre fiche : on repart de ses valeurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospect.id]);

  const reload = useCallback(async () => {
    const { data } = await createClient().from("prospects").select(COLUMNS).eq("id", prospect.id).maybeSingle();
    if (data && !gone.current) setFields(data as ContactFields);
  }, [prospect.id]);

  const find = useCallback(
    async (website: string | null) => {
      setRunning(true);
      setError(null);
      setStep("Recherche du site et du contact");
      try {
        const id = await startJob(
          "reanalyze",
          { prospectId: prospect.id, label: `Contact · ${prospect.company_name}`.slice(0, 160) },
          { prospectId: prospect.id, scope: "contact", website: website?.trim() || null },
        );
        const snapshot = await watchJob(id, { stopped: () => gone.current, onUpdate: (job) => setStep(job.progress?.step ?? null) });
        if (!snapshot || gone.current) return;
        if (snapshot.job.status !== "done") setError(snapshot.job.error ?? "Recherche en échec.");
        setStep(snapshot.job.progress?.step ?? null);
        await reload();
      } catch (cause) {
        if (!gone.current) setError(cause instanceof Error ? cause.message : "Recherche impossible.");
      } finally {
        if (!gone.current) setRunning(false);
      }
    },
    [prospect.id, prospect.company_name, reload],
  );

  return { fields, running, step, error, find };
}
