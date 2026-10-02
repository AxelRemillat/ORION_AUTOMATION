/**
 * Offre d'emploi → pain probable.
 *
 * L'offre est un INDICE du pain, jamais le sujet de l'accroche : on ne
 * félicite pas quelqu'un de recruter, on parle de ce que le poste révèle.
 */

interface PainRule {
  pattern: RegExp;
  pain: string;
}

/**
 * COMPTABILITÉ CLIENTS — facturation et relances de paiement, pas factures
 * fournisseurs.
 *
 * 02/10/2026, NEW NET 3D (511178287) : offre « Comptable clients (H/F) » lue
 * « factures fournisseurs et rapprochement bancaire » parce que la table
 * rangeait tout « comptable » côté fournisseurs. Le côté clients se lit dans
 * l'intitulé, ou — pour un intitulé générique de comptable — dans l'offre ou
 * le profil métier (facturation, relances, encaissement, recouvrement).
 */
export const CLIENT_ACCOUNTING_PAIN = "facturation clients et relances de paiement";

/** L'intitulé dit à lui seul le côté clients. */
const CLIENT_SIDE_TITLE =
  /comptab\w*\s+(des\s+)?clients?|compta\s+clients?|poste\s+clients?|comptes?\s+clients?|credit\s+manager|recouvrement|encaissements?|relances?\s+(de\s+|des\s+)?(paiements?|impayes|clients?|factures)|facturation\s+clients?|factures?\s+clients?|impayes/;
/** Un poste comptable ou de facturation, dont le côté reste à lire. */
const ACCOUNTING_TITLE = /comptab|compta\b|facturation|factures?/;
/** Ce que l'offre ou le profil métier dit du côté clients. */
const CLIENT_SIDE_CONTEXT = /comptab\w*\s+(des\s+)?clients?|facturation|factures?\s+clients?|relances?|encaissements?|recouvrement|impayes|paiements?\s+clients?/;

/**
 * Le poste relève-t-il de la comptabilité CLIENTS ?
 *   - intitulé explicite (« comptable clients », « credit manager »…) : oui ;
 *   - intitulé côté fournisseurs (« comptable fournisseurs ») : non ;
 *   - intitulé comptable générique : oui si l'offre ou le profil métier parle
 *     de facturation, relances, encaissement ou recouvrement (les « relances
 *     fournisseurs » ne comptent pas).
 */
export function isClientAccounting(title: string | null | undefined, context?: string | null): boolean {
  const head = normalize(title ?? "");
  if (CLIENT_SIDE_TITLE.test(head)) return true;
  if (/fournisseurs?/.test(head) || !ACCOUNTING_TITLE.test(head)) return false;
  const around = normalize(context ?? "").replace(/relances?\s+(des\s+|aux\s+)?fournisseurs?/g, " ");
  return CLIENT_SIDE_CONTEXT.test(around);
}

const RULES: readonly PainRule[] = [
  // Élargi le 28/09/2026 : sur 95 offres France Travail du run 69+31, 26 étaient
  // écartées faute d'intitulé reconnu alors que le poste disait bien le pain —
  // « gestionnaire ADV », « approvisionneur », « assistant facturation ».
  { pattern: /back[- ]office|facturation|factures/, pain: "édition et suivi des factures" },
  { pattern: /approvisionn|supply chain|logistique/, pain: "suivi des approvisionnements et des expéditions" },
  { pattern: /secretaire|secretariat|accueil/, pain: "production des documents et classement" },
  { pattern: /achats?\b|acheteur/, pain: "demandes d'achat et commandes fournisseurs" },
  { pattern: /qualite|qhse|hse/, pain: "traçabilité et comptes rendus de contrôle" },
  { pattern: /\badv\b|administration des ventes|assistant(e)? commercial/, pain: "saisie des commandes et des devis" },
  { pattern: /deviseur|charge(e)? d'affaires|technico[- ]commercial/, pain: "production des devis" },
  { pattern: /aide[- ]comptable|comptable/, pain: "factures fournisseurs et rapprochement bancaire" },
  { pattern: /planificat|ordonnanc/, pain: "planning" },
  { pattern: /magasinier|gestionnaire de stock|gestionnaire des stocks|preparateur de commandes/, pain: "gestion du stock" },
  { pattern: /assistant(e)? (administratif|administrative|rh)|assistant(e)? ressources humaines|gestionnaire rh/, pain: "dossiers administratifs et onboarding" },
  { pattern: /service client|charge(e)? de clientele|relation client/, pain: "tri des demandes clients" },
];

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/’/g, "'");
}

/**
 * Pain probable d'un intitulé de poste, ou `null` s'il ne dit rien
 * d'exploitable. `context` (texte de l'offre, profil métier) départage un
 * intitulé comptable générique : côté clients ou côté fournisseurs.
 */
export function painForJob(title: string | null | undefined, context?: string | null): string | null {
  if (!title) return null;
  if (isClientAccounting(title, context)) return CLIENT_ACCOUNTING_PAIN;
  const text = normalize(title);
  return RULES.find((rule) => rule.pattern.test(text))?.pain ?? null;
}

/** La table, telle qu'injectée dans le prompt du tri. */
export function painMapBlock(): string {
  return [
    "- ADV / assistant commercial → saisie des commandes et des devis",
    "- deviseur / chargé d'affaires / technico-commercial → production des devis",
    "- comptable clients / credit manager / recouvrement (ou offre qui parle facturation, relances, encaissement) → facturation clients et relances de paiement",
    "- comptable / aide-comptable (côté fournisseurs) → factures fournisseurs, rapprochement bancaire",
    "- planificateur / ordonnanceur → planning",
    "- magasinier / gestionnaire de stock → gestion du stock",
    "- assistant administratif / RH → dossiers administratifs, onboarding",
    "- service client → tri des demandes clients",
    "- facturation / back-office → édition et suivi des factures",
    "- approvisionneur / supply chain → suivi des approvisionnements",
    "- acheteur → demandes d'achat et commandes fournisseurs",
  ].join("\n");
}
