// Valeurs réglementaires de la micro-entreprise d'Axel (BNC, activité libérale non réglementée, SSI, début 01/09/2026,
// ACRE, déclaration trimestrielle, sans versement libératoire, franchise en base de TVA). TOUTES lues le 18/11/2026 sur
// des pages officielles (URL et date de vérification de la page ci-dessous, détail dans docs/COMPTA.md). Elles changent :
// à revérifier chaque année, rien de mémoire. Montants en centimes.

export const SOURCES = {
  mentionsFacture: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F31808", verifiee: "11/08/2026" },
  mentionsMicro: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F36008", verifiee: "08/12/2025" },
  avoirs: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F23208", verifiee: "07/08/2026" },
  penalites: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F23211", verifiee: "07/08/2026" },
  tauxCotisations: { url: "https://www.urssaf.fr/accueil/actualites/taux-cotisations-autoentrepeneur.html", verifiee: "30/01/2026" },
  statutUrssaf: { url: "https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/lessentiel-du-statut.html", verifiee: "lue le 18/11/2026" },
  acre: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F11677", verifiee: "01/07/2026" },
  plafondMicro: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F32353", verifiee: "21/02/2026" },
  franchiseTva: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F21746", verifiee: "01/01/2026" },
  livreRecettes: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F36018", verifiee: "21/02/2026" },
  facturationElectronique: { url: "https://entreprendre.service-public.gouv.fr/vosdroits/F39785", verifiee: "07/08/2026" },
} as const;

export const COMPTA_CONFIG = {
  /** Cotisations sociales BNC SSI « autres prestations de services » : 25,6 % du CA encaissé depuis le 01/01/2026. */
  tauxCotisations: 0.256,
  /** Contribution à la formation professionnelle, professions libérales : 0,2 % du CA (comptée à part). */
  tauxCfp: 0.002,
  /** ACRE, création à compter du 01/07/2026 : 75 % du taux normal (19,2 % en BNC), jusqu'à la fin du 3e trimestre civil
   * suivant le début d'activité. La page ne dit pas si la CFP est réduite : elle reste pleine ici (point à vérifier). */
  facteurAcre: 0.75,
  /** Plafond du régime micro, prestations BNC : 83 600 € (proratisé l'année de création). */
  plafondMicro: 8_360_000,
  /** Franchise en base de TVA, prestations de services : seuil 37 500 €, seuil majoré 41 250 € (inchangés en 2026). */
  seuilTva: 3_750_000,
  seuilTvaMajore: 4_125_000,
  /** Alerte des jauges : 80 % du seuil. */
  alerte: 0.8,
  /** Délai de paiement par défaut (jours) ; 60 jours au plus après l'émission. */
  echeanceJours: 30,
  validiteDevisJours: 30,
} as const;

/** Mentions de paiement imprimées sur chaque facture (F31808, F23211). */
export const MENTIONS_PAIEMENT = {
  franchiseTva: "TVA non applicable, art. 293 B du CGI",
  escompte: "Escompte pour paiement anticipé : néant",
  penalites: "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal en vigueur, exigibles sans rappel",
  indemnitePro: "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €",
} as const;

/**
 * Dates limites de déclaration (autoentrepreneur.urssaf.fr) : T1 → 30/04, T2 → 31/07, T3 → 31/10, T4 → 31/01 de
 * l'année suivante, reportées au jour ouvré suivant si elles tombent un samedi, un dimanche ou un jour férié.
 */
export const ECHEANCES_TRIMESTRE: Record<1 | 2 | 3 | 4, { mois: number; jour: number; anneeSuivante: boolean }> = {
  1: { mois: 4, jour: 30, anneeSuivante: false },
  2: { mois: 7, jour: 31, anneeSuivante: false },
  3: { mois: 10, jour: 31, anneeSuivante: false },
  4: { mois: 1, jour: 31, anneeSuivante: true },
};

export const MENTION_ESTIMATION = "Estimation indicative, le montant fait foi sur autoentrepreneur.urssaf.fr";
