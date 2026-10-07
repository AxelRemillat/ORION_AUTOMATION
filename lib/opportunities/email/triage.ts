import { isPlatform, type OpportunityStatus, type Platform } from "../types";
import { budgetOf, clientNameOf, quotedTitle, type EmailKind } from "./parse";
import { milestones } from "./milestones";

/**
 * VUE « À TRIER » (plateformes #3) — les e-mails que l'ingestion n'a pas
 * reconnus, et trois actions par e-mail : rattacher à une fiche existante,
 * créer une fiche (plateforme et type choisis par Axel), ignorer. Aucune
 * suppression : « ignorer » ne change que le statut de l'e-mail.
 */

/** Statuts d'un e-mail de plateforme. `ignore` : écarté à la main, gardé pour audit. */
export const EMAIL_STATUSES = ["a_trier", "cree", "rattache", "ignore", "trie"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Types proposés à la création d'une fiche depuis un e-mail. */
export const TRIAGE_KINDS = ["demande", "invitation", "commande", "message", "offre"] as const satisfies readonly EmailKind[];
export type TriageKind = (typeof TRIAGE_KINDS)[number];

export const TRIAGE_KIND_LABELS: Record<TriageKind, string> = {
  demande: "Nouvelle demande",
  invitation: "Invitation",
  commande: "Commande (gagnée)",
  message: "Réponse d'un client",
  offre: "Offre reçue (conversation)",
};

export const isTriageKind = (value: unknown): value is TriageKind => typeof value === "string" && (TRIAGE_KINDS as readonly string[]).includes(value);

/** Statut de la fiche créée selon le type choisi (mêmes règles que l'ingestion automatique). */
export function statusForKind(kind: TriageKind): OpportunityStatus {
  return kind === "commande" ? "gagnee" : kind === "offre" ? "entretien" : kind === "message" ? "reponse" : "a_repondre";
}

/** Une demande ou une invitation passe par l'analyse et la proposition, comme une annonce collée. */
export const needsProposal = (kind: TriageKind) => kind === "demande" || kind === "invitation";

export interface TriageEmail {
  id: string;
  subject: string | null;
  excerpt: string | null;
  from_address: string | null;
  received_at: string | null;
  external_id: string | null;
  message_id?: string | null;
}

/** Fiche à créer depuis un e-mail « à trier » (plateforme et type choisis à la main). */
export function opportunityFromEmail(email: TriageEmail, platform: Platform, kind: TriageKind, userId: string, now = new Date()): Record<string, unknown> {
  const subject = (email.subject ?? "").trim();
  const excerpt = (email.excerpt ?? "").trim();
  const title = (quotedTitle(subject) ?? (subject || excerpt.split("\n")[0] || "E-mail à trier")).slice(0, 300);
  const status = statusForKind(kind);
  const at = email.received_at ?? now.toISOString();
  return {
    user_id: userId,
    source: "email",
    platform,
    external_id: email.external_id ?? `email-tri:${email.id}`,
    title,
    body: excerpt.length >= 40 ? excerpt : [subject, excerpt].filter(Boolean).join("\n\n") || title,
    budget: budgetOf(excerpt),
    client_name: clientNameOf(platform, subject, excerpt),
    published_at: email.received_at,
    description_truncated: true,
    status,
    last_event_at: at,
    ...milestones(status, {}, at),
  };
}

export function parseTriageCreate(raw: Record<string, unknown> | null): { ok: true; platform: Platform; kind: TriageKind } | { ok: false; error: string } {
  if (!raw || !isPlatform(raw.platform)) return { ok: false, error: "Choisissez une plateforme." };
  if (!isTriageKind(raw.kind)) return { ok: false, error: "Choisissez un type." };
  return { ok: true, platform: raw.platform, kind: raw.kind };
}
