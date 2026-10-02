import { BLOCKING_TAGS, MAX_COMPLETE_ATTEMPTS, type TodayTag } from "./types";

/**
 * Étiquettes de complétude d'une fiche — code pur, partagé par l'écran,
 * la préparation automatique et les tests.
 *
 * Une étiquette BLOQUANTE (email manquant ou douteux, opposition non vérifiée,
 * brouillon manquant) renvoie la fiche dans « À compléter » : elle ne peut pas
 * partir telle quelle. Les autres (site, profil métier) sont des signaux de
 * qualité : la fiche reste dans « Nouveaux prospects » si le reste est complet.
 */

export interface TagInput {
  email: string | null;
  /** Adresse gardée sur la seule foi de Hunter, hors du domaine du site. */
  emailDoubtful: boolean;
  oppositionUnverified: boolean;
  website: string | null;
  /** Profil métier lu sur le site (lib/emails/business-profile.ts). */
  hasBusinessProfile: boolean;
  hasDraft: boolean;
  /** Un job de brouillon tourne : pas encore « manquant ». */
  draftPending: boolean;
}

export function tagsOf(input: TagInput): TodayTag[] {
  const tags: TodayTag[] = [];
  if (!input.email) tags.push("Email manquant");
  else if (input.emailDoubtful) tags.push("Email non vérifié");
  if (input.oppositionUnverified) tags.push("Opposition non vérifiée");
  if (!input.website) tags.push("Site introuvable");
  if (!input.hasBusinessProfile) tags.push("Profil métier vide");
  if (!input.hasDraft && !input.draftPending) tags.push("Brouillon manquant");
  return tags;
}

/** La fiche peut-elle figurer dans « Nouveaux prospects » ? */
export const isComplete = (tags: readonly TodayTag[], hasDraft: boolean): boolean =>
  hasDraft && !tags.some((tag) => BLOCKING_TAGS.has(tag));

/**
 * Faut-il retenter la complétion automatique au prochain run ?
 *
 * Une tentative par run, trois au total : au-delà, la fiche est « à compléter
 * manuellement » — inutile de repayer Linkup et Hunter sur une entreprise
 * qui n'a manifestement pas d'adresse publiée.
 */
export function shouldRetryCompletion(input: { attempts: number; lastAttemptRun?: string | null; runId: string }): boolean {
  if (input.attempts >= MAX_COMPLETE_ATTEMPTS) return false;
  return input.lastAttemptRun !== input.runId;
}

/** Libellé de l'état de complétion, pour la fiche. */
export function completionLabel(attempts: number): string {
  if (attempts >= MAX_COMPLETE_ATTEMPTS) return "À compléter manuellement";
  if (attempts === 0) return "Complétion automatique au prochain run";
  return `Complétion automatique : ${attempts} / ${MAX_COMPLETE_ATTEMPTS} tentatives`;
}
