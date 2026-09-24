/**
 * Playbook sectoriel — ce qui s'automatise VRAIMENT, métier par métier.
 *
 * Raison d'être : sans ancrage métier, le modèle produisait le même diagnostic
 * pour une agence d'intérim et un frigoriste industriel — « processus
 * administratifs à optimiser ». Vrai partout, donc utile nulle part, et
 * immédiatement repéré par un dirigeant.
 *
 * Ce module ne remplace pas l'analyse : il lui donne le VOCABULAIRE du secteur.
 * Le modèle reste libre de proposer autre chose s'il a mieux — le playbook est
 * une amorce, pas une réponse.
 *
 * Clé de résolution : la division NAF (deux premiers chiffres), plus fiable
 * qu'un libellé de secteur en texte libre. Le libellé sert de repli.
 */

export interface SectorPlaybook {
  key: string;
  /** Nom du métier tel qu'un dirigeant du secteur le dirait. */
  family: string;
  /** Divisions NAF couvertes (« 78 », « 41 »…). */
  divisions: string[];
  /** Mots du libellé de secteur, pour le repli quand le NAF manque. */
  keywords: string[];
  /** Process réellement automatisables, dans le vocabulaire du métier. */
  processes: string[];
}

const PLAYBOOKS: SectorPlaybook[] = [
  {
    key: "interim_rh",
    family: "Intérim, recrutement et gestion RH",
    divisions: ["78"],
    keywords: ["intérim", "interim", "recrutement", "emploi", "placement", "ressources humaines"],
    processes: [
      "tri et qualification des candidatures entrantes, avec pré-scoring sur les critères de la mission",
      "matching candidats / commandes clients et relances automatiques des intérimaires disponibles",
      "génération et envoi des contrats de mission et des avenants",
      "collecte des relevés d'heures et rapprochement avec la facturation client",
      "suivi des visites médicales, habilitations et documents obligatoires qui expirent",
    ],
  },
  {
    key: "cvc_maintenance",
    family: "Génie climatique, froid et maintenance technique",
    divisions: ["33", "43", "35", "36"],
    keywords: [
      "climatisation", "froid", "frigorifique", "vapeur", "chauffage", "cvc", "génie climatique",
      "maintenance", "installation", "plomberie", "ventilation", "énergie",
    ],
    processes: [
      "planification des interventions et des tournées techniciens selon l'urgence et la zone",
      "rappels automatiques des contrats de maintenance préventive arrivant à échéance",
      "rapports d'intervention saisis sur mobile puis convertis en devis ou en facture",
      "suivi des pièces détachées et réapprovisionnement déclenché par les interventions",
      "traçabilité réglementaire (fluides frigorigènes, registres, attestations) et relances documentaires",
    ],
  },
  {
    key: "btp",
    family: "Construction et travaux",
    divisions: ["41", "42"],
    keywords: ["construction", "bâtiment", "batiment", "travaux", "maçonnerie", "gros œuvre", "btp"],
    processes: [
      "chiffrage et sortie de devis à partir de métrés récurrents",
      "suivi des situations de travaux et des demandes d'acompte",
      "collecte des pointages de chantier et consolidation par affaire",
      "relances des sous-traitants sur les documents obligatoires (attestations, assurances)",
      "gestion des demandes de matériel et des commandes fournisseurs par chantier",
    ],
  },
  {
    key: "industrie",
    family: "Industrie et production",
    divisions: ["10", "11", "13", "14", "15", "16", "17", "18", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32"],
    keywords: ["fabrication", "industrie", "production", "usine", "atelier", "transformation"],
    processes: [
      "prise de commandes clients et accusés de réception générés depuis les bons reçus",
      "ordonnancement de production et alertes sur les ruptures de composants",
      "contrôle qualité : saisie terrain, non-conformités et rapports automatiques",
      "suivi des expéditions et information proactive des clients sur les délais",
      "consolidation des données de production pour le reporting hebdomadaire",
    ],
  },
  {
    key: "transport_logistique",
    family: "Transport et logistique",
    divisions: ["49", "50", "51", "52", "53"],
    keywords: ["transport", "logistique", "livraison", "fret", "entrepôt", "entrepot", "messagerie"],
    processes: [
      "prise de commande de transport et affectation automatique aux tournées",
      "suivi des livraisons et notifications clients sans intervention humaine",
      "rapprochement des lettres de voiture, bons de livraison et factures",
      "gestion des litiges et des retours, avec constitution automatique du dossier",
      "relances sur les documents de transport manquants",
    ],
  },
  {
    key: "commerce",
    family: "Commerce et vente en ligne",
    divisions: ["45", "46", "47"],
    keywords: ["commerce", "vente", "distribution", "négoce", "negoce", "e-commerce", "boutique", "gros"],
    processes: [
      "traitement des commandes entrantes, quel que soit le canal (mail, téléphone, site)",
      "suivi des stocks et réapprovisionnement déclenché par les seuils",
      "réponses aux questions récurrentes des clients (délais, disponibilité, SAV)",
      "génération des devis et relances commerciales sur les paniers en attente",
      "rapprochement des factures fournisseurs et des bons de réception",
    ],
  },
  {
    key: "services_b2b",
    family: "Conseil, ingénierie et services aux entreprises",
    divisions: ["58", "59", "60", "61", "62", "63", "69", "70", "71", "72", "73", "74", "75", "77", "80", "81", "82"],
    keywords: ["conseil", "ingénierie", "ingenierie", "études", "etudes", "informatique", "agence", "expertise", "audit", "architecture"],
    processes: [
      "production et relance des propositions commerciales",
      "suivi du temps passé par mission et préparation de la facturation",
      "compte rendus de réunion et notes de synthèse rédigés depuis les échanges",
      "onboarding client : collecte des pièces, création des accès, ouverture du dossier",
      "veille et qualification des appels d'offres pertinents",
    ],
  },
  {
    key: "sante",
    family: "Santé et action sociale",
    divisions: ["86", "87", "88"],
    keywords: ["santé", "sante", "médical", "medical", "soins", "cabinet", "clinique", "ehpad"],
    processes: [
      "prise de rendez-vous et rappels aux patients pour limiter les absences",
      "constitution et relance des dossiers administratifs incomplets",
      "planification des équipes soignantes et remplacements",
      "transmission des comptes rendus aux correspondants",
      "suivi des renouvellements et des échéances réglementaires",
    ],
  },
  {
    key: "hotellerie_restauration",
    family: "Hôtellerie et restauration",
    divisions: ["55", "56"],
    keywords: ["hôtel", "hotel", "restaurant", "restauration", "traiteur", "hébergement"],
    processes: [
      "gestion des réservations et confirmations multicanal",
      "commandes fournisseurs déclenchées par les prévisions de couverts",
      "planning des équipes et gestion des remplacements",
      "réponses aux avis clients et demandes de devis pour les groupes",
      "suivi des pertes et consolidation des fiches techniques",
    ],
  },
  {
    key: "immobilier",
    family: "Immobilier et gestion locative",
    divisions: ["68"],
    keywords: ["immobilier", "gestion locative", "syndic", "agence immobilière"],
    processes: [
      "qualification des demandes entrantes et organisation des visites",
      "constitution des dossiers locataires et relances des pièces manquantes",
      "suivi des états des lieux et des interventions de maintenance",
      "quittancement, relances d'impayés et régularisations de charges",
      "réponses aux questions récurrentes des copropriétaires",
    ],
  },
];

/** Repli quand on ne sait rien : formulé pour rester honnête, pas générique. */
const FALLBACK: SectorPlaybook = {
  key: "inconnu",
  family: "Secteur non identifié",
  divisions: [],
  keywords: [],
  processes: [],
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Playbook correspondant au prospect.
 *
 * La division NAF prime ; à défaut on cherche un mot du libellé de secteur.
 * Aucune correspondance renvoie un playbook VIDE — et c'est volontaire :
 * mieux vaut dire au modèle qu'on ne sait pas que lui souffler le mauvais
 * vocabulaire.
 */
export function resolvePlaybook(
  nafCode: string | null | undefined,
  sector: string | null | undefined,
): SectorPlaybook {
  const division = typeof nafCode === "string" ? nafCode.replace(/\D/g, "").slice(0, 2) : "";
  if (division) {
    const byDivision = PLAYBOOKS.find((playbook) => playbook.divisions.includes(division));
    if (byDivision) return byDivision;
  }

  if (sector) {
    const haystack = normalize(sector);
    const byKeyword = PLAYBOOKS.find((playbook) =>
      playbook.keywords.some((keyword) => haystack.includes(normalize(keyword))),
    );
    if (byKeyword) return byKeyword;
  }

  return FALLBACK;
}

/** Bloc injecté à l'étape d'analyse. Vide quand le secteur est inconnu. */
export function playbookBlock(playbook: SectorPlaybook): string {
  if (!playbook.processes.length) {
    return `PLAYBOOK SECTORIEL : aucun playbook ne correspond a ce code NAF. Deduis les
process du metier depuis le site et les signaux, et si tu n'as vraiment rien,
dis-le plutot que de sortir une generalite.`;
  }

  return `PLAYBOOK SECTORIEL — ${playbook.family}
Process typiquement automatisables dans ce metier. C'est une AMORCE de
vocabulaire, pas une reponse : si le site ou les signaux montrent autre chose
de plus pertinent, prends-le.
${playbook.processes.map((process) => `- ${process}`).join("\n")}`;
}
