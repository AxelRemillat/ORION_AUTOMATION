/**
 * BOÎTES DE RÔLE JURIDIQUE — jamais un contact de prospection (Cowork #41,
 * 07/10/2026 : LA GERBE SAVOYARDE partait demain sur `rgpd-lgs@`).
 *
 * rgpd, gdpr, dpo, privacy, données personnelles, cnil, juridique, legal,
 * unsubscribe / désabonnement, noreply / no-reply / ne-pas-répondre : en
 * préfixe de la partie locale ou comme l'un de ses morceaux (séparés par . _ - +
 * ou des chiffres). Aucune étape ne les retient (site, Hunter, recherche
 * nominative), et les règles d'envoi les refusent.
 */

const ROLE_WORDS = ["rgpd", "gdpr", "dpo", "privacy", "donneespersonnelles", "donnees", "cnil", "juridique", "legal", "unsubscribe", "desabonnement", "desinscription", "noreply", "nepasrepondre"];

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** En tête de la partie locale, mot entier (« legal- » oui, « legallais » non). */
const ROLE_PREFIX = /^(rgpd|gdpr|dpo|privacy|cnil|juridique|legal|unsubscribe|desabonnement|desinscription|no[._-]?reply|ne[._-]?pas[._-]?repondre|donnees[._-]?personnelles)(?=$|[._+\-\d])/;

export function isRoleBox(email: string | null | undefined): boolean {
  if (!email || !email.includes("@")) return false;
  const local = fold(email.split("@")[0]);
  if (ROLE_PREFIX.test(local)) return true;
  // Ou l'un des morceaux de la partie locale (« service.legal », « contact-rgpd »).
  const parts = local.split(/[._+\-\d]+/).filter(Boolean);
  return parts.some((part) => ROLE_WORDS.includes(part)) || /(^|[._+-])no[._-]?reply($|[._+\-\d])/.test(local);
}

export const ROLE_BOX_REASON = "boîte de rôle juridique (RGPD, DPO, juridique, désabonnement, no-reply) : jamais un contact de prospection";
