/**
 * Agrégats du Cockpit — fonctions PURES.
 * Les pages passent les lignes Supabase brutes, ces fonctions renvoient de quoi
 * afficher. Aucune donnée inventée ici : ce qui n'est pas calculable à partir
 * des tables reste absent, et la page bascule alors sur `_lib/example.ts`.
 */
import type { Deal, InboundMessage, Message, Prospect, Reminder } from "@/types";
import { compareHeat, heatScore, strongestSignal } from "@/lib/scoring";
import type {
  DueReminder,
  PendingInbound,
  FocusAction,
  PendingReply,
  SignalHighlight,
  WeeklyKpis,
} from "./types";

const DAY_MS = 86_400_000;

/** Statuts impliquant qu'un premier message est parti (aligné sur /stats). */
const CONTACTED_STATUSES = new Set([
  "contacte",
  "relance_1",
  "relance_2",
  "repondu",
  "en_discussion",
  "gagne",
  "perdu",
]);
const REPLIED_STATUSES = new Set(["repondu", "en_discussion", "gagne"]);

/** Jours restants avant l'échéance (négatif = en retard). */
const daysUntil = (iso: string, now: number) =>
  Math.floor((Date.parse(iso) - now) / DAY_MS);

/** Extrait lisible du corps d'un email : une seule ligne, sans blancs parasites. */
function excerptOf(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Emails entrants non traités, du plus récent au plus ancien.
 *
 * Un expéditeur non rattaché à un prospect reste affiché — sous son adresse —
 * plutôt que d'être masqué : c'est peut-être justement le contact à créer.
 */
export function pendingInbound(
  inbound: InboundMessage[],
  prospects: Prospect[],
): PendingInbound[] {
  const names = new Map(prospects.map((prospect) => [prospect.id, prospect.company_name]));

  return inbound
    .filter((message) => !message.handled)
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
    .map((message) => ({
      id: message.id,
      prospectId: message.prospect_id,
      label:
        (message.prospect_id ? names.get(message.prospect_id) : null) ?? message.from_email,
      fromEmail: message.from_email,
      subject: message.subject,
      excerpt: excerptOf(message.body),
      category: message.category,
      receivedAt: message.received_at,
    }));
}

/** Relances non faites dont l'échéance est atteinte, les plus en retard d'abord. */
export function dueReminders(
  reminders: Reminder[],
  prospects: Prospect[],
  now = Date.now(),
): DueReminder[] {
  const names = new Map(prospects.map((prospect) => [prospect.id, prospect.company_name]));

  return reminders
    .filter((reminder) => !reminder.done && Date.parse(reminder.due_at) <= now)
    .map((reminder) => ({
      id: reminder.id,
      prospectId: reminder.prospect_id,
      companyName: names.get(reminder.prospect_id) ?? "Prospect supprimé",
      dueAt: reminder.due_at,
      daysLeft: daysUntil(reminder.due_at, now),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Prospects qui ont répondu et attendent une suite. */
export function pendingReplies(prospects: Prospect[]): PendingReply[] {
  return prospects
    .filter((prospect) => prospect.status === "repondu")
    .map((prospect) => ({
      id: prospect.id,
      companyName: prospect.company_name,
      city: prospect.city,
      updatedAt: prospect.updated_at,
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * Signaux les plus forts du portefeuille.
 *
 * Les sources actuelles ne datent pas leurs résultats : on ne peut donc pas
 * trier par fraîcheur réelle. On classe par score de chaleur, et l'écran le dit.
 */
export function topSignals(prospects: Prospect[], limit = 4): SignalHighlight[] {
  return prospects
    .filter((prospect) => prospect.signals?.length)
    .map((prospect) => {
      const score = heatScore(prospect.signals, { seed: prospect.company_name });
      const strongest = strongestSignal(prospect.signals);
      return {
        prospectId: prospect.id,
        companyName: prospect.company_name,
        signal: strongest ?? prospect.signals[0],
        score,
      };
    })
    .sort((a, b) => compareHeat(a.score, b.score))
    .slice(0, limit);
}

/** Indicateurs de la semaine, calculés uniquement sur des lignes réelles. */
export function weeklyKpis(
  prospects: Prospect[],
  messages: Message[],
  deals: Deal[],
  now = Date.now(),
): WeeklyKpis {
  const weekAgo = now - 7 * DAY_MS;

  const sentThisWeek = messages.filter(
    (message) =>
      message.status === "sent" && message.sent_at != null && Date.parse(message.sent_at) >= weekAgo,
  ).length;

  const contactedIds = new Set<string>();
  for (const message of messages) {
    if (message.status === "sent") contactedIds.add(message.prospect_id);
  }
  let replied = 0;
  let meetings = 0;
  for (const prospect of prospects) {
    if (CONTACTED_STATUSES.has(prospect.status)) contactedIds.add(prospect.id);
    if (REPLIED_STATUSES.has(prospect.status)) replied += 1;
    if (prospect.status === "en_discussion") meetings += 1;
  }

  const open = deals.filter((deal) => deal.status === "ouvert");
  const contacted = contactedIds.size;

  return {
    sentThisWeek,
    contacted,
    replied,
    replyRate: contacted > 0 ? replied / contacted : 0,
    pipelineValue: open.reduce((total, deal) => total + (deal.amount_eur ?? 0), 0),
    openDeals: open.length,
    meetings,
  };
}

/**
 * Les 3 actions du jour.
 *
 * Il n'existe pas de table « tâches » : la liste est DÉDUITE de l'état réel du
 * pipeline, par ordre de coût d'un oubli — une relance ratée ou une réponse
 * laissée sans suite coûtent plus cher qu'une approche non préparée.
 */
export function focusActions(
  prospects: Prospect[],
  messages: Message[],
  reminders: Reminder[],
  now = Date.now(),
): FocusAction[] {
  const actions: FocusAction[] = [];

  for (const reminder of dueReminders(reminders, prospects, now)) {
    const late = -reminder.daysLeft;
    actions.push({
      id: `relance-${reminder.id}`,
      kind: "relance",
      title: `Relancer ${reminder.companyName}`,
      reason:
        late > 0 ? `Relance en retard de ${late} jour${late > 1 ? "s" : ""}` : "Relance due aujourd'hui",
      href: `/suivi/${reminder.prospectId}`,
      urgency: "haute",
    });
  }

  for (const reply of pendingReplies(prospects)) {
    actions.push({
      id: `reponse-${reply.id}`,
      kind: "reponse",
      title: `Répondre à ${reply.companyName}`,
      reason: "A répondu et attend une suite",
      href: `/suivi/${reply.id}`,
      urgency: "haute",
    });
  }

  // Brouillon rédigé mais jamais envoyé : le travail est déjà fait.
  const withDraft = new Set(
    messages.filter((message) => message.status === "draft").map((m) => m.prospect_id),
  );
  for (const prospect of prospects) {
    if (prospect.status === "a_contacter" && withDraft.has(prospect.id)) {
      actions.push({
        id: `brouillon-${prospect.id}`,
        kind: "brouillon",
        title: `Envoyer le message à ${prospect.company_name}`,
        reason: "Brouillon prêt, en attente d'envoi",
        href: `/suivi/${prospect.id}`,
        urgency: "moyenne",
      });
    }
  }

  // À défaut, le prospect neuf le plus chaud.
  const coldStart = prospects
    .filter((prospect) => prospect.status === "nouveau")
    .map((prospect) => ({
      prospect,
      score: heatScore(prospect.signals, { seed: prospect.company_name }),
    }))
    .sort((a, b) => compareHeat(a.score, b.score));

  for (const { prospect, score } of coldStart) {
    actions.push({
      id: `approche-${prospect.id}`,
      kind: "approche",
      title: `Préparer l'approche de ${prospect.company_name}`,
      reason: score.real
        ? `Score de chaleur ${score.value}/100`
        : "Nouveau prospect, pas encore travaillé",
      href: "/prospection",
      urgency: "moyenne",
    });
  }

  return actions.slice(0, 3);
}
