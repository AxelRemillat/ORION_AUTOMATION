import type { InboundCategory, Prospect, ProspectSignal } from "@/types";
import type { HeatScore } from "@/lib/scoring";

/** Un email entrant en attente de traitement, prêt à être affiché. */
export interface PendingInbound {
  id: string;
  prospectId: string | null;
  /** Nom du prospect s'il est connu, sinon l'adresse de l'expéditeur. */
  label: string;
  fromEmail: string;
  subject: string | null;
  /** Début du corps, pour donner à lire sans ouvrir. */
  excerpt: string;
  category: InboundCategory;
  receivedAt: string;
}

/** Une action proposée en tête de Cockpit. */
export interface FocusAction {
  id: string;
  kind: "relance" | "reponse" | "brouillon" | "approche" | "exemple";
  title: string;
  /** Pourquoi cette action passe avant les autres. */
  reason: string;
  href: string;
  urgency: "haute" | "moyenne" | "basse";
}

/** Relance arrivée à échéance, avec l'entreprise concernée. */
export interface DueReminder {
  id: string;
  prospectId: string;
  companyName: string;
  dueAt: string;
  /** Négatif si l'échéance est passée. */
  daysLeft: number;
}

/** Prospect ayant répondu et attendant une suite. */
export interface PendingReply {
  id: string;
  companyName: string;
  city: string | null;
  updatedAt: string;
}

/** Signal mis en avant, rattaché à son prospect. */
export interface SignalHighlight {
  prospectId: string;
  companyName: string;
  signal: ProspectSignal;
  score: HeatScore;
}

export interface WeeklyKpis {
  /** Messages réellement envoyés sur les 7 derniers jours. */
  sentThisWeek: number;
  /** Part des contactés qui ont répondu (0–1), même définition que /stats. */
  replyRate: number;
  contacted: number;
  replied: number;
  /** Somme des deals encore ouverts. */
  pipelineValue: number;
  openDeals: number;
  /** Prospects en discussion — le proxy le plus proche d'un RDV pris. */
  meetings: number;
}

export interface CockpitData {
  focus: FocusAction[];
  /** Vrai quand `focus` ne contient que des exemples faute de données réelles. */
  focusIsExample: boolean;
  dueReminders: DueReminder[];
  replies: PendingReply[];
  signals: SignalHighlight[];
  /** Vrai quand `signals` est illustratif (aucun prospect porteur de signal). */
  signalsAreExample: boolean;
  kpis: WeeklyKpis;
  prospectCount: number;
}

/** Sous-ensemble de `Prospect` suffisant aux calculs du Cockpit. */
export type ProspectLite = Pick<
  Prospect,
  "id" | "company_name" | "city" | "status" | "signals" | "updated_at"
>;
