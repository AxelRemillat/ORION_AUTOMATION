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

const normalize = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/’/g, "'");

/** Pain probable d'un intitulé de poste, ou `null` s'il ne dit rien d'exploitable. */
export function painForJob(title: string | null | undefined): string | null {
  if (!title) return null;
  const text = normalize(title);
  return RULES.find((rule) => rule.pattern.test(text))?.pain ?? null;
}

/** La table, telle qu'injectée dans le prompt du tri. */
export function painMapBlock(): string {
  return [
    "- ADV / assistant commercial → saisie des commandes et des devis",
    "- deviseur / chargé d'affaires / technico-commercial → production des devis",
    "- comptable / aide-comptable → factures fournisseurs, rapprochement bancaire",
    "- planificateur / ordonnanceur → planning",
    "- magasinier / gestionnaire de stock → gestion du stock",
    "- assistant administratif / RH → dossiers administratifs, onboarding",
    "- service client → tri des demandes clients",
    "- facturation / back-office → édition et suivi des factures",
    "- approvisionneur / supply chain → suivi des approvisionnements",
    "- acheteur → demandes d'achat et commandes fournisseurs",
  ].join("\n");
}
