/**
 * Agrégats du Cockpit — fonctions PURES.
 * Les pages passent les lignes Supabase brutes, ces fonctions renvoient de quoi
 * afficher. Aucune donnée inventée ici : ce qui n'est pas calculable à partir
 * des tables reste absent, et la page bascule alors sur `_lib/example.ts`.
 */
import type { InboundMessage, Prospect } from "@/types";
import { compareHeat, heatContextOf, heatScore, strongestSignal } from "@/lib/scoring";
import type { InboxEntry, SignalHighlight } from "./types";

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
export function inboxEntries(inbound: InboundMessage[], prospects: Prospect[]): InboxEntry[] {
  const names = new Map(prospects.map((prospect) => [prospect.id, prospect.company_name]));

  return inbound
    .slice()
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
    .slice(0, MAX_INBOX)
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
    }));
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
      const score = heatScore(prospect.signals, {
        seed: prospect.company_name,
        context: heatContextOf(prospect.key_figures),
      });
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
