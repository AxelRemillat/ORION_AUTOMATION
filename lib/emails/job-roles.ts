import { isClientAccounting } from "@/lib/funnel/pain-map";
/**
 * Lecture des offres d'emploi : ce que le poste FAIT, et ce que son ouverture
 * implique opérationnellement.
 *
 * Erreur d'origine : « recrute un automaticien » devenait « alléger des tâches
 * répétitives ». Un automaticien programme des automates et supervise des
 * installations ; son recrutement dit que le parc automatisé grandit ou que
 * la supervision manque de bras — pas qu'il y a de la saisie à supprimer.
 *
 * Table courte et volontairement prudente : la conséquence est PLAUSIBLE, à
 * poser comme hypothèse dans un mail, jamais comme un constat.
 */

export interface JobRole {
  key: string;
  /** Intitulés reconnus, sur texte sans accents. */
  pattern: RegExp;
  label: string;
  /** Ce que le poste fait réellement. */
  does: string;
  /** Conséquence opérationnelle plausible de son ouverture. */
  consequence: string;
}

export const JOB_ROLES: readonly JobRole[] = [
  {
    key: "automaticien",
    pattern: /automaticien|automatisme|roboticien|programmeur (?:api|automate)/,
    label: "Automaticien",
    does: "programme les automates (API), paramètre la supervision, dépanne les installations",
    consequence: "parc automatisé qui s'étend ou supervision sous-dimensionnée : alarmes et interventions à traiter plus vite",
  },
  {
    key: "adv",
    pattern: /\badv\b|administration des ventes|assistant(?:e)? commercial/,
    label: "Assistant(e) ADV",
    does: "saisit les commandes, confirme les délais, suit la facturation et les litiges clients",
    consequence: "volume de commandes en hausse : ressaisie commande → ERP et relances de confirmation",
  },
  {
    key: "planification",
    pattern: /planificat|ordonnanc|planning|dispatch/,
    label: "Planificateur / ordonnanceur",
    does: "arbitre charge et capacité, construit le planning de production ou d'intervention",
    consequence: "planning recalculé souvent à la main quand une commande, une absence ou une panne tombe",
  },
  {
    key: "methodes",
    pattern: /methodes|industrialisation/,
    label: "Technicien / ingénieur méthodes",
    does: "rédige gammes et modes opératoires, chiffre les temps, améliore les postes",
    consequence: "nouvelles références ou nouveau process à documenter : gammes et fiches à produire et tenir à jour",
  },
  {
    key: "data",
    pattern: /data analyst|analyste (?:de )?donnees|business analyst|data engineer/,
    label: "Data analyst",
    does: "consolide les données de plusieurs outils et produit les tableaux de bord",
    consequence: "reporting encore assemblé à la main à partir d'extractions dispersées",
  },
  {
    key: "controle_gestion",
    pattern: /controleur de gestion|controle de gestion/,
    label: "Contrôleur de gestion",
    does: "clôtures mensuelles, budget, analyse d'écarts, reporting direction",
    consequence: "clôture et rapprochements mensuels qui mobilisent du temps de consolidation",
  },
  {
    key: "comptable_clients",
    pattern: /comptab\w* (des )?clients?|compta clients?|poste clients?|credit manager|recouvrement|charge(e)? d'encaissement/,
    label: "Comptable clients",
    does: "facturation clients, encaissements, relances des paiements en retard",
    consequence: "factures clients à émettre et paiements à relancer à la main",
  },
  {
    key: "comptable",
    pattern: /comptable|aide-comptable|comptabilite fournisseurs/,
    label: "Comptable",
    does: "saisie et lettrage des pièces, rapprochements bancaires, relances",
    consequence: "flux de factures fournisseurs à saisir, rapprocher et relancer",
  },
  {
    key: "achats",
    pattern: /acheteur|approvisionn|supply chain|gestionnaire de stock/,
    label: "Acheteur / approvisionneur",
    does: "passe les commandes fournisseurs, suit les délais, gère les ruptures",
    consequence: "réapprovisionnement déclenché à la main et relances fournisseurs",
  },
  {
    key: "maintenance",
    pattern: /technicien de maintenance|technicien d'intervention|frigoriste|technicien sav/,
    label: "Technicien de maintenance",
    does: "intervient sur site, diagnostique, remplace les pièces, rédige les rapports",
    consequence: "interventions plus nombreuses : ordres de travail, pièces et rapports à coordonner",
  },
  {
    key: "paie_rh",
    pattern: /gestionnaire (?:de )?paie|charge(?:e)? de recrutement|assistant(?:e)? rh|gestionnaire rh/,
    label: "Paie / RH",
    does: "prépare la paie, gère contrats et entrées-sorties, trie les candidatures",
    consequence: "dossiers salariés, contrats et variables de paie qui se multiplient",
  },
];

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Poste reconnu dans un texte d'offre, ou `null`. */
export function interpretJob(text: string, context?: string | null): JobRole | null {
  const haystack = normalize(text);
  const role = JOB_ROLES.find((item) => item.pattern.test(haystack)) ?? null;
  // Comptable générique : l'offre ou le profil métier dit si c'est le côté clients.
  if (role?.key === "comptable" && isClientAccounting(text, `${text} ${context ?? ""}`)) {
    return JOB_ROLES.find((item) => item.key === "comptable_clients") ?? role;
  }
  return role;
}

/** La table, telle qu'injectée dans le prompt du stratège. */
export function jobRolesBlock(): string {
  return JOB_ROLES.map((role) => `- ${role.label} : ${role.does}. Ouverture ⇒ ${role.consequence}.`).join("\n");
}
