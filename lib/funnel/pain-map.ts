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
  { pattern: /\badv\b|administration des ventes|assistant(e)? commercial/, pain: "saisie des commandes et des devis" },
  { pattern: /deviseur|charge(e)? d'affaires|technico[- ]commercial/, pain: "production des devis" },
  { pattern: /aide[- ]comptable|comptable/, pain: "factures fournisseurs et rapprochement bancaire" },
  { pattern: /planificat|ordonnanc/, pain: "planning" },
  { pattern: /magasinier|gestionnaire de stock|gestionnaire des stocks/, pain: "gestion du stock" },
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
  ].join("\n");
}
