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
  /** Domaine de l'e-mail ≠ domaine du site, et contact non confirmé par Axel. */
  contactToCheck?: boolean;
  oppositionUnverified: boolean;
  website: string | null;
  /** Profil métier lu sur le site (lib/emails/business-profile.ts). */
  hasBusinessProfile: boolean;
  /** La lecture du site a déjà échoué (`key_figures.profile_failed_at`). */
  profileReadFailed?: boolean;
  hasDraft: boolean;
  /** Un job de brouillon tourne : pas encore « manquant ». */
  draftPending: boolean;
  /** Filiale d'un groupe (lib/enrichment/subsidiary.ts) : signalée, non bloquante. */
  subsidiary?: string | null;
  /**
   * À revoir : brouillon noté sous 9/10 (`messages.quality_reason`), ou aucun
   * mail rédigé faute de matière (`key_figures.mail_review` : profil
   * insuffisant, pain incertain).
   */
  qualityReview?: boolean;
  /** Porte « faits » (Cowork #31) : aucun fait distinctif, mail volontairement non rédigé. */
  factsInsufficient?: boolean;
  /** Segment de la fiche (lib/segments) : étiquette d'appartenance, non bloquante. */
  segment?: string | null;
}

export function tagsOf(input: TagInput): TodayTag[] {
  const tags: TodayTag[] = [];
  if (!input.email) tags.push("Email manquant");
  else if (input.emailDoubtful) tags.push("Email non vérifié");
  else if (input.contactToCheck) tags.push("Contact à vérifier");
  if (input.oppositionUnverified) tags.push("Opposition non vérifiée");
  if (!input.website) tags.push("Site introuvable");
  // Site connu, profil vide : JAMAIS de brouillon sans l'avoir lu (bloquant).
  // Sans site, le profil vide n'est qu'une information.
  if (!input.hasBusinessProfile) tags.push(input.website ? "Profil à compléter" : "Profil métier vide");
  // Bloqué faute de matière : « À revoir », pas « Brouillon manquant » — sinon
  // la préparation relancerait la rédaction à chaque run, pour rien.
  if (!input.hasDraft && !input.draftPending && !input.qualityReview && !input.factsInsufficient) tags.push("Brouillon manquant");
  if (input.subsidiary) tags.push("Filiale de groupe");
  if (input.factsInsufficient) tags.push("Faits insuffisants");
  else if (input.qualityReview) tags.push("À revoir");
  // Appartenance à un segment : information, jamais un blocage.
  if (input.segment === "agences") tags.push("Agences");
  return tags;
}

/**
 * Fiche qui n'attend plus que son brouillon : contact sûr, opposition vérifiée.
 * « Profil à compléter » n'empêche pas la génération : elle LIT le site
 * d'abord et refuse de rédiger si la lecture échoue — sauf si cette lecture a
 * déjà échoué (il faut alors corriger le site ou compléter le profil).
 */
export function needsIntroDraft(item: {
  messageType: string;
  status: string;
  messageId: string | null;
  draftPending: boolean;
  contact: { email: string | null };
  tags: readonly TodayTag[];
  profileReadFailed?: boolean;
}): boolean {
  if (item.messageType !== "intro" || item.status !== "todo" || item.messageId || item.draftPending) return false;
  if (!item.contact.email || !item.tags.includes("Brouillon manquant")) return false;
  if (item.profileReadFailed && item.tags.includes("Profil à compléter")) return false;
  // « Contact à vérifier » n'empêche pas d'écrire : le brouillon attend la confirmation dans « À compléter ».
  return !item.tags.some((tag) => tag !== "Brouillon manquant" && tag !== "Profil à compléter" && tag !== "Contact à vérifier" && BLOCKING_TAGS.has(tag));
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
