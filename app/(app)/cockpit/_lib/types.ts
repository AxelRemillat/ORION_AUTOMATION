import type { InboundCategory } from "@/types";
import type { AutoReplyKind } from "@/lib/inbound/auto-reply";

/**
 * Types du Cockpit encore en usage : l'aperçu de la boîte mail. Les types de
 * l'ancienne file d'actions et des « signaux les plus forts » ont été retirés
 * avec ces blocs (03/10/2026).
 */

/**
 * Un email de la boîte de réception, corps compris.
 *
 * Le corps part vers le client pour alimenter le panneau de lecture : il est
 * donc tronqué, et la liste est plafonnée. On n'envoie pas toute l'archive.
 */
export interface InboxEntry {
  id: string;
  prospectId: string | null;
  /** Nom du prospect s'il est connu, sinon l'adresse de l'expéditeur. */
  label: string;
  fromEmail: string;
  subject: string | null;
  excerpt: string;
  body: string;
  category: InboundCategory;
  receivedAt: string;
  /** Non lu = pas encore traité depuis le Cockpit. */
  unread: boolean;
  /** Prospect marqué « ne plus contacter ». */
  doNotContact: boolean;
  /** Réponse automatique (challenge anti-spam, absence) : pas une réponse du prospect. */
  autoKind: AutoReplyKind | null;
  /** Challenge anti-spam : lien de validation, sur le domaine de l'expéditeur uniquement. */
  validationLink: string | null;
  /** Challenge anti-spam marqué « Validé » (mail délivré). */
  validated: boolean;
}
