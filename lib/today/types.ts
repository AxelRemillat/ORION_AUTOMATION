import type { TodayKind } from "@/types";

/**
 * « Aujourd'hui » — la file du jour, telle que l'écran la consomme.
 *
 * Rien n'est stocké sous cette forme : la file est RECALCULÉE à chaque
 * chargement à partir des tables existantes (inbound, messages, reminders,
 * signal_candidates, prospects). C'est ce qui garantit qu'aucune donnée
 * n'est dupliquée et que les fiches déjà trouvées y apparaissent d'office.
 */

/** Où en est un élément dans la journée. */
export type TodayStatus = "todo" | "valide" | "ecarte" | "programme" | "envoye";

/** Étiquettes d'une fiche incomplète — visibles sur la ligne et sur la fiche. */
export const TODAY_TAGS = [
  "Email manquant",
  "Email non vérifié",
  "Contact à vérifier",
  "Opposition non vérifiée",
  "Site introuvable",
  "Profil métier vide",
  "Profil à compléter",
  "Brouillon manquant",
  "Filiale de groupe",
  "À revoir",
  // Porte « faits » (Cowork #31) : aucun fait distinctif, aucun mail rédigé.
  "Faits insuffisants",
] as const;
export type TodayTag = (typeof TODAY_TAGS)[number];

/** Une étiquette BLOQUANTE renvoie la fiche dans « À compléter ». */
export const BLOCKING_TAGS: ReadonlySet<TodayTag> = new Set([
  "Email manquant",
  "Email non vérifié",
  // E-mail hors du domaine du site, non confirmé par Axel (lib/today/contact-domain.ts).
  "Contact à vérifier",
  "Opposition non vérifiée",
  "Profil à compléter",
  "Brouillon manquant",
  // Note du juge qualité sous 9/10 : pas dans « Nouveaux prospects ».
  "À revoir",
  "Faits insuffisants",
]);

export type ContactKind = "nominatif" | "generique" | "aucun";

export interface TodayContact {
  email: string | null;
  kind: ContactKind;
  name: string | null;
  /** Poste de la personne contactée (contact nominatif) ; absent = le dirigeant. */
  role?: string | null;
  /** Téléphone du site ou de l'annuaire : affiché quand l'email reste introuvable. */
  phone: string | null;
}

export interface TodaySignal {
  date: string | null;
  source: string;
  label: string;
  url: string | null;
}

export interface TodayFact {
  label: string;
  value: string;
}

export interface TodayItem {
  /** Clé stable entre deux rendus : `kind:id`. */
  key: string;
  kind: TodayKind;
  status: TodayStatus;
  prospectId: string | null;
  candidateId: string | null;
  /** Brouillon concerné (intro, relance ou réponse), s'il existe. */
  messageId: string | null;
  inboundId: string | null;
  companyName: string;
  /** Ligne secondaire de la liste : « Décines · 33,5 M€ · recrute… ». */
  subline: string;
  /** Score du tri (0 à 5) : ordre des nouveaux prospects. */
  score: number | null;
  contact: TodayContact;
  messageType: "intro" | "relance" | "reponse";
  received: { body: string; at: string } | null;
  signal: TodaySignal | null;
  facts: TodayFact[];
  subject: string;
  /** Corps SANS mention « stop » ni signature : ce que l'éditeur montre. */
  body: string;
  /** Lignes verrouillées, non comptées : mention « stop » puis signature. */
  optOut: boolean;
  signature: string | null;
  why: string[];
  tags: TodayTag[];
  website: string | null;
  /** Tentatives de complétion automatique déjà faites (max 3). */
  attempts: number;
  scheduledAt: string | null;
  /** Un brouillon est en cours de génération pour cette fiche. */
  draftPending: boolean;
  /** Note /10 du juge qualité (petit badge sur la carte) ; `null` = brouillon d'avant. */
  quality?: number | null;
  /** Famille du mail (expérience n° 2 : F1 à F4), badge sur la carte. */
  family?: string | null;
  /**
   * La lecture du site pour le profil métier a échoué : pas de brouillon
   * automatique tant que le site n'est pas corrigé ou le profil complété.
   */
  profileReadFailed?: boolean;
  /** Relance : quelle relance rédiger si le brouillon manque. */
  followUpType?: "relance_1" | "relance_2";
}

export interface TodayGroup {
  kind: TodayKind;
  label: string;
  items: TodayItem[];
}

export const GROUP_LABELS: Record<TodayKind, string> = {
  reponse: "Réponses à traiter",
  relance: "Relances du jour",
  nouveau: "Nouveaux prospects",
  a_completer: "À compléter",
};

/** Tentatives de complétion automatique avant « à compléter manuellement ». */
export const MAX_COMPLETE_ATTEMPTS = 3;
