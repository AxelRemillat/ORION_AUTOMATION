import { offTargetReason } from "@/lib/funnel/off-target";
import type { FunnelCard } from "@/lib/funnel/view";
import type { InboundMessage, Message, Prospect } from "@/types";
import { splitBody } from "./body";
import type { RawTodayItem } from "./group";
import { tagsOf } from "./tags";
import type { TodayContact, TodayFact, TodaySignal, TodayStatus } from "./types";

/**
 * Construction des éléments de la file à partir des lignes en base.
 *
 * Aucun appel réseau ici : le chargeur (load.ts) lit, ce module assemble. Les
 * règles d'affichage (sous-ligne, faits clés, « pourquoi ») vivent donc à un
 * seul endroit, et se testent.
 */

type Draft = Pick<Message, "id" | "subject" | "body" | "status" | "sent_at" | "send_status" | "scheduled_at"> & {
  validated_at?: string | null;
};

/** Pourquoi on n'écrit pas à cette fiche — `null` si rien ne s'y oppose. */
export function exclusionOf(prospect: Prospect | null): string | null {
  if (!prospect) return null;
  if (prospect.do_not_contact) return "ne plus contacter";
  if (prospect.key_figures?.refuses_prospecting) return "opposé à la prospection";
  const off = offTargetReason(prospect);
  return off ? `hors cible : ${off}` : null;
}

/** Où en est l'élément aujourd'hui, d'après son brouillon et les écarts. */
export function statusOf(draft: Draft | null, discardedToday: boolean): TodayStatus {
  if (discardedToday) return "ecarte";
  if (!draft) return "todo";
  if (draft.status === "sent") return "envoye";
  if (draft.send_status === "scheduled" || draft.send_status === "sending") return "programme";
  return draft.validated_at ? "valide" : "todo";
}

function contactOf(prospect: Prospect | null, card: FunnelCard | null): TodayContact {
  const email = prospect?.email ?? card?.email ?? null;
  const kind = !email ? "aucun" : prospect?.email_type === "generique" || card?.contact === "generique" ? "generique" : "nominatif";
  const figures = prospect?.key_figures ?? {};
  const name = typeof figures.leader_person === "string" ? figures.leader_person : null;
  return { email, kind, name, phone: card?.phone ?? null };
}

function signalOf(prospect: Prospect | null, card: FunnelCard | null): TodaySignal | null {
  if (card) {
    const label = card.jobTitle ? `Offre : ${card.jobTitle}` : card.newLeader ? `${card.label} — ${card.newLeader}` : card.label;
    return { date: card.date, source: card.sourceLabel, label, url: card.url };
  }
  const first = prospect?.signals?.[0];
  return first ? { date: first.date ?? null, source: first.source ?? "Signal", label: first.label, url: first.url ?? null } : null;
}

function factsOf(prospect: Prospect | null, card: FunnelCard | null, contact: TodayContact): TodayFact[] {
  const facts: TodayFact[] = [];
  const sector = prospect?.sector;
  if (sector) facts.push({ label: "Activité", value: [sector, prospect?.size_range].filter(Boolean).join(", ") });
  if (card?.revenue) facts.push({ label: "Chiffre d'affaires", value: card.revenue.replace(/^CA /, "") });
  const city = prospect?.city ?? card?.city;
  if (city) facts.push({ label: "Ville", value: city });
  if (contact.name) facts.push({ label: "Dirigeant", value: contact.name });
  return facts.slice(0, 4);
}

const sublineOf = (city: string | null | undefined, revenue: string | null | undefined, signal: TodaySignal | null) =>
  [city, revenue?.replace(/^CA \d{4} : /, ""), signal?.label?.replace(/^Offre : /, "recrute ").toLowerCase()]
    .filter(Boolean)
    .join(" · ");

/** Fiche de prospection : intro, ou « à compléter » s'il manque l'essentiel. */
export function prospectItem(input: {
  prospect: Prospect;
  card: FunnelCard | null;
  draft: Draft | null;
  signature: string | null;
  discardedToday: boolean;
  draftPending: boolean;
  attempts: number;
  weight: number | null;
}): RawTodayItem {
  const { prospect, card, draft } = input;
  const contact = contactOf(prospect, card);
  const signal = signalOf(prospect, card);
  const split = splitBody(draft?.body ?? "", input.signature);
  const tags = tagsOf({
    email: contact.email,
    emailDoubtful: card?.emailDoubtful ?? false,
    oppositionUnverified: card?.oppositionUnverified ?? prospect.key_figures?.opposition_checked === false,
    website: prospect.website,
    hasBusinessProfile: Boolean(prospect.business_profile && Object.keys(prospect.business_profile).length),
    hasDraft: Boolean(draft),
    draftPending: input.draftPending,
  });
  return {
    key: `prospect:${prospect.id}`,
    kind: "nouveau",
    status: statusOf(draft, input.discardedToday),
    prospectId: prospect.id,
    candidateId: card?.id ?? null,
    messageId: draft?.id ?? null,
    inboundId: null,
    companyName: prospect.company_name,
    subline: sublineOf(prospect.city ?? card?.city, card?.revenue, signal),
    score: card?.score ?? null,
    contact,
    messageType: "intro",
    received: null,
    signal,
    facts: factsOf(prospect, card, contact),
    subject: draft?.subject ?? "",
    body: split.core,
    optOut: split.optOut,
    signature: split.signature,
    why: [card?.pain && `Pain : ${card.pain}`, card?.hook && `Accroche : ${card.hook}`, card?.score != null && `Score ${card.score}/5`]
      .filter((line): line is string => Boolean(line)),
    tags,
    website: prospect.website,
    attempts: input.attempts,
    scheduledAt: draft?.scheduled_at ?? null,
    draftPending: input.draftPending,
    exclusion: exclusionOf(prospect),
    weight: input.weight,
  };
}

/** Relance due aujourd'hui, dans le fil de l'intro. */
export function relanceItem(input: {
  prospect: Prospect;
  draft: Draft | null;
  signature: string | null;
  dueAt: string;
  lastSent: { type: string; sent_at: string | null; subject: string | null };
  discardedToday: boolean;
  draftPending: boolean;
}): RawTodayItem {
  const base = prospectItem({ ...input, card: null, attempts: 0, weight: null });
  const day = input.lastSent.sent_at ? new Date(input.lastSent.sent_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "?";
  const step = input.lastSent.type === "intro" ? "J+4" : "J+7";
  return {
    ...base,
    key: `relance:${input.prospect.id}`,
    kind: "relance",
    messageType: "relance",
    subline: `Relance ${step} · ${input.lastSent.type === "intro" ? "intro" : "relance"} du ${day} sans réponse`,
    why: [`Même fil que l'envoi du ${day}.`, step === "J+4" ? "Dernière relance prévue : J+7." : "Dernière relance de la séquence."],
    dueAt: input.dueAt,
    // Une relance sans brouillon reste une relance : elle ne bascule pas en « à compléter ».
    tags: base.tags.filter((tag) => tag === "Brouillon manquant"),
  };
}

/** Réponse reçue à traiter, avec le brouillon de réponse proposé. */
export function replyItem(input: {
  inbound: InboundMessage;
  prospect: Prospect | null;
  draft: Draft | null;
  signature: string | null;
  discardedToday: boolean;
}): RawTodayItem {
  const { inbound, prospect, draft } = input;
  const split = splitBody(draft?.body ?? "", input.signature);
  const at = new Date(inbound.received_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return {
    key: `reponse:${inbound.id}`,
    kind: "reponse",
    status: statusOf(draft, input.discardedToday),
    prospectId: prospect?.id ?? null,
    candidateId: null,
    messageId: draft?.id ?? null,
    inboundId: inbound.id,
    companyName: prospect?.company_name ?? inbound.from_email,
    subline: [prospect?.sector, `réponse reçue ${at}`].filter(Boolean).join(" · "),
    score: null,
    contact: { email: inbound.from_email, kind: "nominatif", name: null, phone: null },
    messageType: "reponse",
    received: { body: inbound.body, at: inbound.received_at },
    signal: null,
    facts: prospect ? factsOf(prospect, null, contactOf(prospect, null)) : [],
    subject: draft?.subject ?? (inbound.subject ? `Re: ${inbound.subject.replace(/^re\s*:\s*/i, "")}` : ""),
    body: split.core,
    optOut: false,
    signature: split.signature,
    why: [inbound.category ? `Classée « ${inbound.category} ».` : "Réponse reçue."],
    tags: draft ? [] : ["Brouillon manquant"],
    website: prospect?.website ?? null,
    attempts: 0,
    scheduledAt: draft?.scheduled_at ?? null,
    draftPending: false,
    exclusion: exclusionOf(prospect),
    receivedAt: inbound.received_at,
  };
}
