"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { useToast } from "@/components/ui";
import type { Opportunity, Platform } from "@/lib/opportunities/types";
import type { PlatformTab } from "@/lib/opportunities/tabs";

export type NewOpportunity = { platform: Platform; url: string; title: string; body: string; budget: string; deadline: string };

export const emptyForm = (platform: Platform): NewOpportunity => ({ platform, url: "", title: "", body: "", budget: "", deadline: "" });

/**
 * Actions de la page Opportunités (création, mise à jour, analyse, copie). Aucun
 * envoi : on ouvre l'annonce, on copie la proposition, on marque « envoyée ».
 */
export function useOpportunityActions(setItems: Dispatch<SetStateAction<Opportunity[]>>, tab: PlatformTab) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  /** Relecture complète (analyse et proposition sont écrites côté serveur), sur la fiche concernée. */
  function reload(focus?: string) {
    window.location.assign(focus ? `/opportunites?id=${encodeURIComponent(focus)}` : `/opportunites?p=${tab}`);
  }

  async function create(form: NewOpportunity): Promise<boolean> {
    setBusy("create");
    try {
      const response = await fetch("/api/opportunites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = (await response.json()) as { id?: string; error?: string; warning?: string };
      if (!response.ok || !result.id) {
        toast.error(result.error ?? "Opportunité non enregistrée.");
        return false;
      }
      if (result.warning) toast.toast(`Enregistrée, mais ${result.warning}`, "info");
      else toast.success("Opportunité analysée, proposition prête.");
      reload(result.id);
      return true;
    } finally {
      setBusy(null);
    }
  }

  const merge = (id: string, patch: Partial<Opportunity>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  async function patch(id: string, body: Record<string, unknown>, success: string | null): Promise<boolean> {
    setBusy(`patch:${id}`);
    try {
      const response = await fetch(`/api/opportunites/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json()) as { patch?: Partial<Opportunity>; error?: string };
      if (!response.ok || !result.patch) {
        toast.error(result.error ?? "Non enregistré.");
        return false;
      }
      merge(id, result.patch);
      if (success) toast.success(success);
      return true;
    } finally {
      setBusy(null);
    }
  }

  /** Alerte vue : sans attendre, sans toast. */
  function markSeen(item: Opportunity) {
    if (item.seen_at) return;
    merge(item.id, { seen_at: new Date().toISOString() });
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
  async function regenerateFromFullText(id: string, fullText: string): Promise<boolean> {
    if (fullText.trim().length < 40) {
      toast.error("Collez le texte complet de l'annonce.");
      return false;
    }
    if (!(await patch(id, { body: fullText }, null))) return false;
    await regenerate(id);
    return true;
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

  return { busy, reload, create, patch, merge, markSeen, regenerate, regenerateFromFullText, copy };
}

export type OpportunityActions = ReturnType<typeof useOpportunityActions>;
