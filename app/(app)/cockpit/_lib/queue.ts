import type { Message, Prospect, Reminder } from "@/types";
import { compareHeat, heatContextOf, heatScore, type ScoreLine } from "@/lib/scoring";

/**
 * File d'attente du Cockpit.
 *
 * Une seule file, triée par urgence décroissante, dont on n'affiche que les
 * trois premières entrées. Le reste n'est pas perdu : le compteur le montre,
 * et la suivante remonte dès qu'une action sort.
 *
 * La file est DÉRIVÉE des tables métier, jamais stockée. Conséquence voulue :
 * une action se referme d'elle-même quand l'événement réel a lieu — relance
 * soldée, brouillon envoyé, prospect passé en « contacté ». Aucune
 * synchronisation à maintenir, aucun risque de file qui ment.
 *
 * Seules deux décisions ne sont portées par aucune table métier : « traité
 * autrement » et « pas aujourd'hui ». Elles vivent dans `action_states`.
 */

export type QueueKind =
  | "reponse"
  | "relance_retard"
  | "relance_jour"
  | "brouillon"
  | "approche";

export interface QueueAction {
  /** Identifiant stable entre deux chargements : sert de clé à `action_states`. */
  id: string;
  kind: QueueKind;
  title: string;
  /** Pourquoi elle passe avant les autres. */
  reason: string;
  /** Où mène le bouton d'action principal. */
  href: string;
  /** Libellé de ce bouton : « Relancer », « Envoyer »… */
  cta: string;
  /** 0 → 1. Pilote l'intensité de la flamme. */
  heat: number;
  /**
   * Bonus et malus qui ont fait ce score. Affichés sous la ligne : un score
   * qu'on ne peut pas discuter est un score qu'on ne peut pas corriger.
   */
  scoreLines?: ScoreLine[];
  prospectId: string | null;
}

/** Décision prise sur une action, telle que stockée. */
export interface ActionStateRow {
  action_id: string;
  state: "done" | "snoozed";
  snooze_until: string | null;
}

/**
 * Réponse entrante non traitée.
 *
 * Décrite structurellement plutôt qu'importée : la boîte de réception est en
 * cours de construction, et cette file doit compiler et fonctionner qu'elle
 * soit branchée ou non.
 */
export interface PendingInboundLike {
  id: string;
  prospect_id: string | null;
}

/** Poids de base par nature d'action. L'ordre de cette table EST la priorité. */
const KIND_WEIGHT: Record<QueueKind, number> = {
  reponse: 5000,
  relance_retard: 4000,
  relance_jour: 3000,
  brouillon: 2000,
  approche: 1000,
};

const DAY_MS = 86_400_000;

const startOfDay = (time: number): number => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** Demain matin : échéance d'un report. */
export function tomorrowMorning(now = Date.now()): Date {
  return new Date(startOfDay(now) + DAY_MS);
}

export interface QueueResult {
  /** Les trois premières, dans l'ordre. */
  visible: QueueAction[];
  /** Tout ce qui attend, report et traité exclus. */
  total: number;
}

export interface QueueInput {
  prospects: Prospect[];
  messages: Message[];
  reminders: Reminder[];
  inbound?: PendingInboundLike[];
  states?: ActionStateRow[];
  now?: number;
  /** Nombre d'actions affichées. Trois, sauf en test. */
  size?: number;
}

/**
 * Construit la file complète, applique les décisions enregistrées, et renvoie
 * la tête de file avec le total restant.
 */
export function buildQueue(input: QueueInput): QueueResult {
  const now = input.now ?? Date.now();
  const size = input.size ?? 3;
  const today = startOfDay(now);

  const byId = new Map(input.prospects.map((prospect) => [prospect.id, prospect]));
  const nameOf = (prospectId: string | null) =>
    (prospectId ? byId.get(prospectId)?.company_name : null) ?? "ce prospect";

  const actions: { action: QueueAction; rank: number }[] = [];

  // 1. Une réponse reçue attend quelqu'un en face : rien ne passe avant.
  for (const item of input.inbound ?? []) {
    actions.push({
      action: {
        id: `reponse-${item.id}`,
        kind: "reponse",
        title: `Répondre à ${nameOf(item.prospect_id)}`,
        reason: "A répondu et attend une suite",
        href: item.prospect_id ? `/suivi/${item.prospect_id}` : "/suivi",
        cta: "Répondre",
        heat: 1,
        prospectId: item.prospect_id,
      },
      rank: KIND_WEIGHT.reponse,
    });
  }

  // 2 et 3. Relances : les plus en retard d'abord, puis celles du jour.
  for (const reminder of input.reminders) {
    if (reminder.done) continue;
    const due = Date.parse(reminder.due_at);
    if (Number.isNaN(due) || due > today + DAY_MS) continue;

    const daysLate = Math.max(0, Math.round((today - startOfDay(due)) / DAY_MS));
    const late = daysLate > 0;
    const name = nameOf(reminder.prospect_id);

    actions.push({
      action: {
        id: `relance-${reminder.id}`,
        kind: late ? "relance_retard" : "relance_jour",
        title: `Relancer ${name}`,
        reason: late
          ? `En retard de ${daysLate} jour${daysLate > 1 ? "s" : ""}`
          : "Relance due aujourd'hui",
        href: `/suivi/${reminder.prospect_id}`,
        cta: "Relancer",
        // Plus c'est en retard, plus ça flambe — plafonné à dix jours.
        heat: late ? Math.min(1, 0.7 + (Math.min(daysLate, 10) / 10) * 0.3) : 0.6,
        prospectId: reminder.prospect_id,
      },
      rank: (late ? KIND_WEIGHT.relance_retard : KIND_WEIGHT.relance_jour) + daysLate,
    });
  }

  // 4. Brouillon validé : le travail est fait, il ne manque que l'envoi.
  const drafts = new Map<string, Message>();
  for (const message of input.messages) {
    if (message.status !== "draft") continue;
    const current = drafts.get(message.prospect_id);
    if (!current || message.created_at > current.created_at) {
      drafts.set(message.prospect_id, message);
    }
  }
  for (const [prospectId, draft] of drafts) {
    actions.push({
      action: {
        id: `brouillon-${draft.id}`,
        kind: "brouillon",
        title: `Envoyer le message à ${nameOf(prospectId)}`,
        reason: "Brouillon prêt, en attente d'envoi",
        href: `/suivi/${prospectId}`,
        cta: "Envoyer",
        heat: 0.45,
        prospectId,
      },
      rank: KIND_WEIGHT.brouillon,
    });
  }

  // 5. Prospects chauds jamais contactés, du plus chaud au plus froid.
  const untouched = input.prospects
    .filter((prospect) => prospect.status === "nouveau" || prospect.status === "a_contacter")
    .filter((prospect) => !drafts.has(prospect.id))
    .map((prospect) => ({
      prospect,
      score: heatScore(prospect.signals, {
        seed: prospect.company_name,
        context: heatContextOf(prospect.key_figures),
      }),
    }))
    .sort((a, b) => compareHeat(a.score, b.score));

  for (const { prospect, score } of untouched) {
    actions.push({
      action: {
        id: `approche-${prospect.id}`,
        kind: "approche",
        scoreLines: score.breakdown,
        title: `Préparer l'approche de ${prospect.company_name}`,
        reason: score.real
          ? `Score de chaleur ${score.value}/100`
          : "Pas encore travaillé, aucun signal avéré",
        href: "/prospection",
        cta: "Préparer l'approche",
        heat: 0.2 + (score.real ? (score.value / 100) * 0.3 : 0),
        prospectId: prospect.id,
      },
      rank: KIND_WEIGHT.approche + score.value,
    });
  }

  // Décisions enregistrées : « traité » sort définitivement, « reporté » sort
  // jusqu'au lendemain puis revient tout seul.
  const hidden = new Set<string>();
  for (const row of input.states ?? []) {
    if (row.state === "done") {
      hidden.add(row.action_id);
      continue;
    }
    const until = row.snooze_until ? Date.parse(row.snooze_until) : NaN;
    if (!Number.isNaN(until) && until > now) hidden.add(row.action_id);
  }

  const queue = actions
    .filter((entry) => !hidden.has(entry.action.id))
    .sort((a, b) => b.rank - a.rank)
    .map((entry) => entry.action);

  return { visible: queue.slice(0, size), total: queue.length };
}
