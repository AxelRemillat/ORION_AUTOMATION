/**
 * DOULEURS DAF / RAF (Cowork #44).
 *
 * Mesure #43 : sur 4 fiches dont le brief portait sur le reporting ou la
 * clôture, AUCUN mail n'en parlait (références manquantes, contrôle
 * d'arrivage, notifications d'éleveurs…). Le sujet honnête et réel pour un DAF
 * de PME, montrable par la démo FACTURES : le rapprochement factures
 * fournisseurs / commandes / bons de livraison avant la clôture du mois
 * (écart de quantité ou de prix, facture sans bon de commande).
 */

const DAF_PAIN = /(reporting|cl[ôo]ture|rapproch|consolid|comptab|lettrage|tr[ée]sorerie|encaissement|factures? fournisseurs?|rapprochement bancaire|[ée]critures?)/i;
const DAF_ROLE = /\b(daf|raf|directeur administratif|directrice administrative|responsable administratif|responsable administrative|comptable|contr[ôo]leur de gestion|chef comptable|finance|financier|financi[èe]re)\b/i;

export function isDafPain(pain: { task?: string | null; automationIdea?: string | null } | null | undefined, recipientRole?: string | null): boolean {
  return DAF_PAIN.test(`${pain?.task ?? ""} ${pain?.automationIdea ?? ""}`) || DAF_ROLE.test(recipientRole ?? "");
}

/** Consigne imposée au rédacteur quand la douleur est DAF / RAF. */
export const DAF_FOCUS = `DOULEUR DAF / RAF — SUJET IMPOSÉ (Cowork #44) : le rapprochement des factures FOURNISSEURS avec les commandes et les bons de livraison avant la clôture du mois. Le problème nomme un écart précis (quantité ou prix facturé différent de la commande, facture sans bon de commande, bon de livraison manquant) et sa conséquence (clôture retardée, écart découvert trop tard, paiement bloqué). La proposition : je rapproche chaque facture de sa commande et de son bon de livraison et je signale les écarts avant la clôture. JAMAIS un autre sujet (références manquantes dans les commandes clients, dimensions, livraisons gratuites côté client…).
Le fait sur l'entreprise doit MENER à ce problème (ses achats, ses fournisseurs, ses volumes de factures). S'il n'y mène pas naturellement, AUCUN fait d'entreprise : ouvre directement sur le problème. Jamais deux phrases juxtaposées sans lien (Cowork #45 : « livraison gratuite dès 12 bouteilles » puis « écart sur une facture fournisseur » = refusé).
En question courte (F3), sur ce modèle : « Qui rapproche chez vous les factures fournisseurs des bons de livraison avant la clôture ? »`;

/** DAF / RAF : la question courte (F3) est privilégiée — le sujet n'a pas besoin d'un fait d'entreprise (Cowork #45). */
export const DAF_FAMILY = "F3" as const;

const DAF_TOPIC = /factur/i;
const DAF_ANCHOR = /(commande|bons? de livraison|\bBL\b|rapproch|cl[ôo]ture|[ée]cart)/i;

/** Un mail sur une douleur DAF parle des factures ET de leur rapprochement (commande, BL, écart, clôture). */
export function dafFailures(text: string): string[] {
  if (DAF_TOPIC.test(text) && DAF_ANCHOR.test(text)) return [];
  return ["Douleur DAF / RAF : le mail doit parler du rapprochement des factures fournisseurs avec les commandes et bons de livraison avant la clôture (écart de quantité ou de prix, facture sans bon de commande), pas d'un autre sujet."];
}

/** « Entre X et Y, … » : ouverture devenue un tic (FRIAX, DERELEK, #43). */
export const ENTRE_OPENING = /^\s*entre\s+[^,.;]{2,80}\s+et\s+/i;
/** Combien de brouillons prêts récents sont regardés. */
export const ENTRE_WINDOW = 5;
