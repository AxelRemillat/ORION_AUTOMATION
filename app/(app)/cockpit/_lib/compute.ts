/**
 * Agrégats du Cockpit — fonctions PURES.
 * Les pages passent les lignes Supabase brutes, ces fonctions renvoient de quoi
 * afficher. Aucune donnée inventée ici : ce qui n'est pas calculable à partir
 * des tables reste absent.
 */
import type { InboundMessage, Prospect } from "@/types";
import type { InboxEntry } from "./types";
import { antispamLink, autoReplyKind } from "@/lib/inbound/auto-reply";

/** Extrait lisible du corps d'un email : une seule ligne, sans blancs parasites. */
function excerptOf(body: string, max = 160): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Corps borne : le panneau de lecture n'a pas besoin d'une archive complete. */
const MAX_BODY = 4000;
/** Profondeur de la boite : au-dela, c'est de l'archive, pas du Cockpit. */
const MAX_INBOX = 30;

/**
 * Toute la boite de reception, du plus recent au plus ancien.
 *
 * Contrairement a `pendingInbound`, les messages deja traites sont conserves :
 * une messagerie sans historique n'est pas une messagerie. Le point « non lu »
 * distingue ce qui reste a faire.
 */
export function inboxEntries(inbound: InboundMessage[], prospects: Prospect[], max = MAX_INBOX): InboxEntry[] {
  const names = new Map(prospects.map((prospect) => [prospect.id, prospect.company_name]));
  const blocked = new Set(prospects.filter((prospect) => prospect.do_not_contact).map((prospect) => prospect.id));
  const figures = new Map(prospects.map((prospect) => [prospect.id, (prospect.key_figures ?? {}) as Record<string, unknown>]));

  return inbound
    .filter((message) => !message.deleted_at)
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
    .slice(0, max)
    .map((message) => ({
      id: message.id,
      prospectId: message.prospect_id,
      label: (message.prospect_id ? names.get(message.prospect_id) : null) ?? message.from_email,
      fromEmail: message.from_email,
      subject: message.subject,
      excerpt: excerptOf(message.body),
      body: message.body.slice(0, MAX_BODY),
      category: message.category,
      receivedAt: message.received_at,
      unread: !message.handled,
      doNotContact: Boolean(message.prospect_id && blocked.has(message.prospect_id)),
      autoKind: autoReplyKind(message),
      validationLink: antispamLink(message),
      validated: Boolean(
        message.prospect_id &&
          figures.get(message.prospect_id)?.antispam_inbound_id === message.id &&
          figures.get(message.prospect_id)?.antispam_validated_at,
      ),
    }));
}
