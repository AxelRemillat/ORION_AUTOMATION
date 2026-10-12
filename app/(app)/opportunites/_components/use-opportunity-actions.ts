"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { useToast } from "@/components/ui";
import type { Opportunity, Platform } from "@/lib/opportunities/types";
import type { PlatformTab } from "@/lib/opportunities/tabs";
import { PROPOSAL_FAILED } from "@/lib/opportunities/proposal-state";
import { optimisticPatch } from "@/lib/opportunities/optimistic";

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

  /**
   * Mise à jour OPTIMISTE (Cowork #23) : l'écran change tout de suite ; un refus du serveur
   * remet les valeurs d'avant et le dit. La réponse du serveur (jalons datés…) complète ensuite.
   */
  async function patch(id: string, body: Record<string, unknown>, success: string | null): Promise<boolean> {
    let before: Opportunity | undefined;
    setItems((current) => {
      before = current.find((item) => item.id === id);
      return current.map((item) => (item.id === id ? { ...item, ...optimisticPatch(body) } : item));
    });
    setBusy(`patch:${id}`);
    const rollback = (message: string) => {
      if (before) merge(id, before);
      toast.error(message);
      return false;
    };
    try {
      const response = await fetch(`/api/opportunites/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => ({}))) as { patch?: Partial<Opportunity>; error?: string };
      if (!response.ok || !result.patch) return rollback(result.error ?? "Non enregistré : valeur d'avant remise.");
      merge(id, result.patch);
      if (success) toast.success(success);
      return true;
    } catch {
      return rollback("Réseau indisponible : valeur d'avant remise.");
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
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        // Échec affiché sur le bouton (« Échec — réessayer »), jamais un « en cours » sans fin (Cowork #21).
        merge(id, { proposal_reason: `${PROPOSAL_FAILED} : ${result.error ?? "analyse indisponible"}` });
        toast.error(result.error ?? "Analyse indisponible.");
      } else reload(id);
    } catch {
      merge(id, { proposal_reason: `${PROPOSAL_FAILED} : réseau indisponible` });
      toast.error("Réseau indisponible : réessayez.");
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
