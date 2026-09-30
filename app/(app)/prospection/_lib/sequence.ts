import { offWeekend } from "@/lib/outbox/paris-time";
import type { Message, ProspectStatus, Reminder } from "@/types";

/**
 * Séquence d'approche en quatre temps : intro, relance J+4, relance J+7,
 * clôture. Le modèle est ici pour préparer l'écran ; l'exécution reste
 * inchangée (rédaction ici, envoi et relances depuis le Suivi via n8n).
 *
 * Les délais reproduisent ceux réellement appliqués par
 * `/api/emails/send` : +4 jours après l'intro, +7 après la première relance,
 * repoussés au lundi quand ils tombent un week-end.
 */

export const SEQUENCE_DELAYS = { relance_1: 4, relance_2: 7 } as const;

export type StepState =
  /** Rien n'existe encore pour cette étape. */
  | "todo"
  /** Message rédigé, en attente d'envoi. */
  | "draft"
  /** Message parti. */
  | "sent"
  /** Relance programmée (reminder ouvert). */
  | "planned"
  /** Étape sans objet : le prospect est déjà sorti de la séquence. */
  | "skipped";

export interface SequenceStep {
  key: "intro" | "relance_1" | "relance_2" | "cloture";
  label: string;
  hint: string;
  state: StepState;
  /** Date associée à l'état (envoi effectué ou relance prévue). */
  at?: string;
}

const CLOSED: ProspectStatus[] = ["gagne", "perdu"];
/** Le prospect a répondu : les relances programmées n'ont plus lieu d'être. */
const ANSWERED: ProspectStatus[] = ["repondu", "en_discussion", "gagne"];

function stepFromMessages(
  messages: Message[],
  type: Message["type"],
): { state: StepState; at?: string } | null {
  const found = messages.filter((message) => message.type === type);
  if (found.length === 0) return null;
  const sent = found.find((message) => message.status === "sent");
  if (sent) return { state: "sent", at: sent.sent_at ?? sent.created_at };
  return { state: "draft", at: found[0].created_at };
}

/** État des quatre étapes pour un prospect donné. */
export function buildSequence(
  messages: Message[],
  reminders: Reminder[],
  status: ProspectStatus,
): SequenceStep[] {
  const openReminder = reminders.find((reminder) => !reminder.done);
  const answered = ANSWERED.includes(status);
  const closed = CLOSED.includes(status);

  const intro = stepFromMessages(messages, "intro") ?? { state: "todo" as StepState };
  const relance1 = stepFromMessages(messages, "relance_1");
  const relance2 = stepFromMessages(messages, "relance_2");

  /** Une relance non rédigée est « programmée » si un rappel court, sinon à faire. */
  const pending = (previousSent: boolean): { state: StepState; at?: string } => {
    if (answered) return { state: "skipped" };
    if (!previousSent) return { state: "todo" };
    // Une relance du samedi ou du dimanche part le lundi.
    return openReminder
      ? { state: "planned", at: offWeekend(new Date(openReminder.due_at)).toISOString() }
      : { state: "todo" };
  };

  const introSent = intro.state === "sent";
  const relance1Sent = relance1?.state === "sent";

  return [
    {
      key: "intro",
      label: "Intro",
      hint: "Premier contact personnalisé",
      ...intro,
    },
    {
      key: "relance_1",
      label: `Relance J+${SEQUENCE_DELAYS.relance_1}`,
      hint: "Rappel court, même fil de discussion",
      ...(relance1 ?? pending(introSent)),
    },
    {
      key: "relance_2",
      label: `Relance J+${SEQUENCE_DELAYS.relance_2}`,
      hint: "Dernière tentative, porte laissée ouverte",
      ...(relance2 ?? pending(Boolean(relance1Sent))),
    },
    {
      key: "cloture",
      label: "Clôture",
      hint: "Gagné, perdu, ou mis en veille",
      state: closed ? "sent" : answered ? "todo" : relance2?.state === "sent" ? "todo" : "skipped",
    },
  ];
}
