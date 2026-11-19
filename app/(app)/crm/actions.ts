"use server";

import { revalidatePath } from "next/cache";
import { modeDemo } from "@/lib/demo";
import { depotCrm } from "@/lib/crm/depot";
import { changementEtape, nettoyerSaisie, type Erreurs, type Saisie } from "@/lib/crm/logique";
import { chercherSiren, type CandidatSiren } from "@/lib/crm/siren";
import { estEtape, estTypeEvenement, type Commerce, type Etape } from "@/lib/crm/types";

/**
 * Actions du CRM (Cowork #117). Client de SESSION : la RLS limite tout aux lignes d'Axel. Aucune suppression : une
 * fiche s'archive (masquée), jamais effacée. Aucun appel payant (le SIREN passe par l'annuaire gratuit de l'État).
 */

export type Resultat<T = object> = ({ ok: true } & T) | { ok: false; error: string; erreurs?: Erreurs };

const SESSION = { ok: false as const, error: "Session expirée. Reconnectez-vous." };

async function connecte(): Promise<boolean> {
  if (modeDemo()) return true;
  const { createClient } = await import("@/lib/supabase/server");
  const { data } = await createClient().auth.getUser();
  return Boolean(data.user);
}

function rafraichir(id?: string) {
  revalidatePath("/crm");
  revalidatePath("/aujourdhui");
  if (id) revalidatePath(`/crm/${id}`);
}

const message = (e: unknown) => (e instanceof Error ? e.message : "Erreur inattendue.");

/** Création d'une fiche (formulaire rapide du téléphone ou formulaire complet). */
export async function creerCommerce(saisie: Saisie): Promise<Resultat<{ id: string }>> {
  if (!(await connecte())) return SESSION;
  const { valeurs, erreurs } = nettoyerSaisie(saisie, true);
  if (Object.keys(erreurs).length) return { ok: false, error: "Vérifiez les champs signalés.", erreurs };
  try {
    const depot = await depotCrm();
    const c = await depot.creer(valeurs as Partial<Commerce> & { nom: string });
    await depot.ajouterEvenement(c.id, { type: "note", contenu: "Fiche créée", meta: { creation: true } });
    rafraichir(c.id);
    return { ok: true, id: c.id };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Modification d'une fiche (seuls les champs envoyés changent). L'étape passe par `deplacerCommerce`. */
export async function modifierCommerce(id: string, saisie: Saisie): Promise<Resultat> {
  if (!(await connecte())) return SESSION;
  const { etape: _ignore, ...reste } = saisie;
  const { valeurs, erreurs } = nettoyerSaisie(reste, false);
  if (Object.keys(erreurs).length) return { ok: false, error: "Vérifiez les champs signalés.", erreurs };
  try {
    await (await depotCrm()).modifier(id, valeurs);
    rafraichir(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Changement d'étape (kanban, liste ou fiche) : écrit l'étape ET l'événement de chronologie. */
export async function deplacerCommerce(id: string, etape: string, motif?: string | null): Promise<Resultat<{ etape: Etape }>> {
  if (!(await connecte())) return SESSION;
  if (!estEtape(etape)) return { ok: false, error: "Étape inconnue." };
  try {
    const depot = await depotCrm();
    const avant = await depot.commerce(id);
    if (!avant) return { ok: false, error: "Fiche introuvable." };
    const r = changementEtape(avant, etape, { motif });
    if ("erreur" in r) return { ok: false, error: r.erreur };
    if ("identique" in r) return { ok: true, etape };
    await depot.modifier(id, r.champs);
    await depot.ajouterEvenement(id, r.evenement);
    rafraichir(id);
    return { ok: true, etape };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Ajout à la chronologie (appel, visite, message, RDV, devis, note), avec en option la PROCHAINE ACTION datée qui
 * remplace la précédente — c'est elle qui remonte dans « Aujourd'hui ».
 */
export async function ajouterEvenement(
  id: string,
  saisie: { type: string; contenu?: string; survenuLe?: string; prochaineAction?: string; prochaineActionLe?: string },
): Promise<Resultat> {
  if (!(await connecte())) return SESSION;
  if (!estTypeEvenement(saisie.type) || saisie.type === "etape") return { ok: false, error: "Type d'événement inconnu." };
  const contenu = saisie.contenu?.trim() || null;
  if (!contenu && saisie.type === "note") return { ok: false, error: "Une note ne peut pas être vide." };
  try {
    const depot = await depotCrm();
    const survenu = saisie.survenuLe && /^\d{4}-\d{2}-\d{2}$/.test(saisie.survenuLe) ? new Date(`${saisie.survenuLe}T12:00:00`).toISOString() : undefined;
    await depot.ajouterEvenement(id, { type: saisie.type, contenu, survenu_le: survenu });
    if (saisie.prochaineAction !== undefined || saisie.prochaineActionLe !== undefined) {
      const { valeurs } = nettoyerSaisie({ prochaine_action: saisie.prochaineAction ?? "", prochaine_action_le: saisie.prochaineActionLe ?? "" }, false);
      await depot.modifier(id, valeurs);
    }
    rafraichir(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** « Fait » depuis Aujourd'hui : trace l'action dans la chronologie et pose (ou efface) la suivante. */
export async function terminerAction(id: string, suite: { prochaineAction?: string; prochaineActionLe?: string }): Promise<Resultat> {
  if (!(await connecte())) return SESSION;
  try {
    const depot = await depotCrm();
    const c = await depot.commerce(id);
    if (!c) return { ok: false, error: "Fiche introuvable." };
    await depot.ajouterEvenement(id, { type: "note", contenu: `Fait : ${c.prochaine_action ?? "action du jour"}`, meta: { action_faite: c.prochaine_action, prevue_le: c.prochaine_action_le } });
    const { valeurs } = nettoyerSaisie({ prochaine_action: suite.prochaineAction ?? "", prochaine_action_le: suite.prochaineActionLe ?? "" }, false);
    await depot.modifier(id, valeurs);
    rafraichir(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** Masquer (archiver) ou réafficher une fiche. Jamais de suppression. */
export async function archiverCommerce(id: string, archiver: boolean): Promise<Resultat> {
  if (!(await connecte())) return SESSION;
  try {
    await (await depotCrm()).modifier(id, { archivee_le: archiver ? new Date().toISOString() : null });
    rafraichir(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** SIREN : candidats de l'annuaire gratuit de l'État (rien n'est enregistré sans le choix d'Axel). */
export async function chercherSirenCommerce(nom: string, ville?: string | null): Promise<Resultat<{ candidats: CandidatSiren[] }>> {
  if (!(await connecte())) return SESSION;
  const r = await chercherSiren(nom, ville);
  return r.ok ? { ok: true, candidats: r.candidats } : { ok: false, error: r.error };
}
