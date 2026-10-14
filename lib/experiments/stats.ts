import { autoReplyKind } from "@/lib/inbound/auto-reply";
import { isBounce } from "@/lib/inbound/bounce";
import { parseVariants, type ExperimentVariant } from "./model";

/**
 * MESURE D'UNE EXPÉRIENCE (Cowork #30) — encart du Cockpit.
 *
 * Par variante, en PROSPECTS (un prospect qui répond trois fois compte une fois) :
 *   envoyés   intro de la variante partie (statut « sent ») ;
 *   réponses  vraie réponse reçue après l'envoi — ni rebond, ni absence, ni anti-spam ;
 *   positives réponse classée « réponse » ou « question », sans refus ;
 *   refus     réponse classée « refus » ;
 *   absences  réponse automatique d'absence.
 * Une réponse rattachée par le fil ou l'adresse porte le `prospect_id` de la
 * fiche : elle compte pour la variante de l'INTRO de ce prospect.
 */
export interface VariantStats {
  key: string;
  cta: string;
  sent: number;
  replies: number;
  positives: number;
  refusals: number;
  absences: number;
}

export interface ExperimentStats {
  id: string;
  name: string;
  active: boolean;
  startedAt: string | null;
  variants: VariantStats[];
}

export interface StatsInput {
  experiments: { id: string; name: string; active: boolean; started_at: string | null; variants: unknown }[];
  assignments: { message_id: string; experiment_id: string; variant: string }[];
  messages: { id: string; prospect_id: string | null; status: string; sent_at: string | null; deleted_at?: string | null }[];
  inbound: { prospect_id: string | null; from_email: string; subject: string | null; body: string | null; category: string; received_at: string; deleted_at?: string | null }[];
}

type Tally = { sent: Set<string>; replies: Set<string>; positives: Set<string>; refusals: Set<string>; absences: Set<string> };
const emptyTally = (): Tally => ({ sent: new Set(), replies: new Set(), positives: new Set(), refusals: new Set(), absences: new Set() });

export function computeExperimentStats(input: StatsInput): ExperimentStats[] {
  const messages = new Map(input.messages.map((message) => [message.id, message]));
  return input.experiments.flatMap((experiment) => {
    const variants = parseVariants(experiment.variants);
    if (!variants) return [];
    const tallies = new Map<string, Tally>(variants.map((variant) => [variant.key, emptyTally()]));
    // Prospect → variante et date de son intro envoyée (la plus ancienne, si plusieurs).
    const intro = new Map<string, { variant: string; sentAt: string }>();
    for (const assignment of input.assignments) {
      if (assignment.experiment_id !== experiment.id || !tallies.has(assignment.variant)) continue;
      const message = messages.get(assignment.message_id);
      if (!message?.prospect_id || message.status !== "sent" || !message.sent_at || message.deleted_at) continue;
      const known = intro.get(message.prospect_id);
      if (!known || message.sent_at < known.sentAt) intro.set(message.prospect_id, { variant: assignment.variant, sentAt: message.sent_at });
    }
    for (const [prospectId, { variant }] of intro) tallies.get(variant)!.sent.add(prospectId);

    for (const reply of input.inbound) {
      const origin = reply.prospect_id ? intro.get(reply.prospect_id) : undefined;
      if (!origin || reply.deleted_at || reply.received_at < origin.sentAt) continue;
      const tally = tallies.get(origin.variant)!;
      const mail = { from_email: reply.from_email, subject: reply.subject, body: reply.body };
      if (isBounce(mail)) continue;
      const kind = autoReplyKind(mail);
      if (kind === "absence") tally.absences.add(reply.prospect_id!);
      if (kind) continue;
      tally.replies.add(reply.prospect_id!);
      if (reply.category === "refus") tally.refusals.add(reply.prospect_id!);
      else if (reply.category === "reponse" || reply.category === "question") tally.positives.add(reply.prospect_id!);
    }
    const stats = variants.map((variant: ExperimentVariant) => {
      const tally = tallies.get(variant.key)!;
      // Un prospect qui a fini par refuser n'est pas une réponse positive.
      const positives = [...tally.positives].filter((id) => !tally.refusals.has(id)).length;
      return { key: variant.key, cta: variant.cta, sent: tally.sent.size, replies: tally.replies.size, positives, refusals: tally.refusals.size, absences: tally.absences.size };
    });
    return [{ id: experiment.id, name: experiment.name, active: experiment.active, startedAt: experiment.started_at, variants: stats }];
  });
}

type Loose = { from: (table: string) => any };

/** Lecture pour le Cockpit. Tables absentes ou erreur : aucune expérience, aucun encart. */
export async function loadExperimentStats(db: unknown, userId: string): Promise<ExperimentStats[]> {
  try {
    const loose = db as Loose;
    const { data: experiments } = await loose.from("mail_experiments").select("id, name, active, started_at, variants").eq("user_id", userId).order("created_at", { ascending: false });
    if (!experiments?.length) return [];
    const { data: assignments } = await loose.from("mail_experiment_assignments").select("message_id, experiment_id, variant").in("experiment_id", experiments.map((row: { id: string }) => row.id));
    const ids = ((assignments ?? []) as { message_id: string }[]).map((row) => row.message_id);
    const { data: messages } = ids.length ? await loose.from("messages").select("id, prospect_id, status, sent_at, deleted_at").in("id", ids) : { data: [] };
    const prospects = [...new Set(((messages ?? []) as { prospect_id: string | null }[]).map((row) => row.prospect_id).filter(Boolean))];
    const { data: inbound } = prospects.length
      ? await loose.from("inbound_messages").select("prospect_id, from_email, subject, body, category, received_at, deleted_at").in("prospect_id", prospects)
      : { data: [] };
    return computeExperimentStats({ experiments, assignments: assignments ?? [], messages: messages ?? [], inbound: inbound ?? [] });
  } catch {
    return [];
  }
}
