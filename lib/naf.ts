/**
 * Libellés NAF rév. 2.
 *
 * Pourquoi ce module : `recherche-entreprises.api.gouv.fr` renvoie le CODE
 * (« 25.50B ») et la SECTION (« C »), mais jamais le libellé de la sous-classe.
 * On affichait donc « Industrie manufacturière » pour un emboutisseur — une
 * information vraie mais inutilisable pour écrire un mail.
 *
 * Résolution dégressive, avec la précision atteinte remontée à l'appelant :
 *   1. sous-classe exacte (table curée ci-dessous) ;
 *   2. division (les 88 divisions, toutes présentes) ;
 *   3. section (21 libellés, dernier recours).
 *
 * La table des sous-classes est VOLONTAIREMENT partielle. Les 732 libellés ne
 * sont pas publiés dans un format machine fiable, et écrire de mémoire un
 * libellé faux serait pire qu'un libellé large : une erreur de libellé envoie
 * l'analyse sur un métier qui n'est pas le leur. On complète au fil des codes
 * réellement rencontrés.
 */

export type NafPrecision = "sous-classe" | "division" | "section";

export interface NafLabel {
  label: string;
  precision: NafPrecision;
  /** Division à deux chiffres, utile pour le playbook. */
  division: string;
}

/** Sous-classes rencontrées en prospection, vérifiées une à une. */
const SUBCLASS: Record<string, string> = {
  "25.50A": "Forge, estampage, matriçage ; métallurgie des poudres",
  "25.50B": "Découpage, emboutissage",
  "25.61Z": "Traitement et revêtement des métaux",
  "25.62A": "Décolletage",
  "25.62B": "Mécanique industrielle",
  "25.73A": "Fabrication de moules et modèles",
  "25.99B": "Fabrication d'autres articles métalliques",
  "33.12Z": "Réparation de machines et équipements mécaniques",
  "33.20A": "Installation de structures métalliques, chaudronnées et de tuyauterie",
  "35.11Z": "Production d'électricité",
  "35.30Z": "Production et distribution de vapeur et d'air conditionné",
  "41.20A": "Construction de maisons individuelles",
  "41.20B": "Construction d'autres bâtiments",
  "43.21A": "Travaux d'installation électrique dans tous locaux",
  "43.22A": "Travaux d'installation d'eau et de gaz en tous locaux",
  "43.22B": "Travaux d'installation d'équipements thermiques et de climatisation",
  "45.11Z": "Commerce de voitures et de véhicules automobiles légers",
  "46.90Z": "Commerce de gros non spécialisé",
  "47.91A": "Vente à distance sur catalogue général",
  "47.91B": "Vente à distance sur catalogue spécialisé",
  "49.41A": "Transports routiers de fret interurbains",
  "49.41B": "Transports routiers de fret de proximité",
  "52.10B": "Entreposage et stockage non frigorifique",
  "52.10A": "Entreposage et stockage frigorifique",
  "52.29A": "Messagerie, fret express",
  "52.29B": "Affrètement et organisation des transports",
  "62.01Z": "Programmation informatique",
  "62.02A": "Conseil en systèmes et logiciels informatiques",
  "62.03Z": "Gestion d'installations informatiques",
  "64.20Z": "Activités des sociétés holding",
  "64.30Z": "Fonds de placement et entités financières similaires",
  "68.20A": "Location de logements",
  "68.20B": "Location de terrains et d'autres biens immobiliers",
  "68.31Z": "Agences immobilières",
  "68.32A": "Administration d'immeubles et autres biens immobiliers",
  "69.10Z": "Activités juridiques",
  "69.20Z": "Activités comptables",
  "70.10Z": "Activités des sièges sociaux",
  "70.21Z": "Conseil en relations publiques et communication",
  "70.22Z": "Conseil pour les affaires et autres conseils de gestion",
  "71.12B": "Ingénierie, études techniques",
  "73.11Z": "Activités des agences de publicité",
  "74.90B": "Activités spécialisées, scientifiques et techniques diverses",
  "77.32Z": "Location et location-bail de machines et équipements pour la construction",
  "78.10Z": "Activités des agences de placement de main-d'œuvre",
  "78.20Z": "Activités des agences de travail temporaire",
  "78.30Z": "Autre mise à disposition de ressources humaines",
  "80.10Z": "Activités de sécurité privée",
  "81.21Z": "Nettoyage courant des bâtiments",
  "82.11Z": "Services administratifs combinés de bureau",
  "82.20Z": "Activités de centres d'appels",
  "85.59A": "Formation continue d'adultes",
  "86.21Z": "Activité des médecins généralistes",
  "86.90F": "Activités de santé humaine non classées ailleurs",
  "87.10A": "Hébergement médicalisé pour personnes âgées",
  "88.10A": "Aide à domicile",
  "95.11Z": "Réparation d'ordinateurs et d'équipements périphériques",
};

/** Les 88 divisions de la NAF rév. 2. Toujours disponibles comme repli. */
const DIVISION: Record<string, string> = {
  "01": "Culture et production animale, chasse", "02": "Sylviculture et exploitation forestière",
  "03": "Pêche et aquaculture", "05": "Extraction de houille et de lignite",
  "06": "Extraction d'hydrocarbures", "07": "Extraction de minerais métalliques",
  "08": "Autres industries extractives", "09": "Services de soutien aux industries extractives",
  "10": "Industries alimentaires", "11": "Fabrication de boissons", "12": "Fabrication de produits à base de tabac",
  "13": "Fabrication de textiles", "14": "Industrie de l'habillement", "15": "Industrie du cuir et de la chaussure",
  "16": "Travail du bois et fabrication d'articles en bois", "17": "Industrie du papier et du carton",
  "18": "Imprimerie et reproduction d'enregistrements", "19": "Cokéfaction et raffinage",
  "20": "Industrie chimique", "21": "Industrie pharmaceutique",
  "22": "Fabrication de produits en caoutchouc et en plastique",
  "23": "Fabrication d'autres produits minéraux non métalliques", "24": "Métallurgie",
  "25": "Fabrication de produits métalliques, hors machines et équipements",
  "26": "Fabrication de produits informatiques, électroniques et optiques",
  "27": "Fabrication d'équipements électriques", "28": "Fabrication de machines et équipements",
  "29": "Industrie automobile", "30": "Fabrication d'autres matériels de transport",
  "31": "Fabrication de meubles", "32": "Autres industries manufacturières",
  "33": "Réparation et installation de machines et d'équipements",
  "35": "Production et distribution d'électricité, de gaz, de vapeur et d'air conditionné",
  "36": "Captage, traitement et distribution d'eau", "37": "Collecte et traitement des eaux usées",
  "38": "Collecte, traitement et élimination des déchets", "39": "Dépollution et autres services de gestion des déchets",
  "41": "Construction de bâtiments", "42": "Génie civil", "43": "Travaux de construction spécialisés",
  "45": "Commerce et réparation d'automobiles et de motocycles",
  "46": "Commerce de gros, à l'exception des automobiles",
  "47": "Commerce de détail, à l'exception des automobiles",
  "49": "Transports terrestres et transport par conduites", "50": "Transports par eau", "51": "Transports aériens",
  "52": "Entreposage et services auxiliaires des transports", "53": "Activités de poste et de courrier",
  "55": "Hébergement", "56": "Restauration", "58": "Édition", "59": "Production de films et d'enregistrements sonores",
  "60": "Programmation et diffusion", "61": "Télécommunications",
  "62": "Programmation, conseil et autres activités informatiques", "63": "Services d'information",
  "64": "Activités des services financiers, hors assurance", "65": "Assurance",
  "66": "Activités auxiliaires de services financiers et d'assurance", "68": "Activités immobilières",
  "69": "Activités juridiques et comptables", "70": "Activités des sièges sociaux ; conseil de gestion",
  "71": "Activités d'architecture et d'ingénierie ; contrôle et analyses techniques",
  "72": "Recherche-développement scientifique", "73": "Publicité et études de marché",
  "74": "Autres activités spécialisées, scientifiques et techniques", "75": "Activités vétérinaires",
  "77": "Activités de location et location-bail", "78": "Activités liées à l'emploi",
  "79": "Agences de voyage et voyagistes", "80": "Enquêtes et sécurité",
  "81": "Services relatifs aux bâtiments et aménagement paysager",
  "82": "Activités administratives et autres activités de soutien aux entreprises",
  "84": "Administration publique", "85": "Enseignement", "86": "Activités pour la santé humaine",
  "87": "Hébergement médico-social", "88": "Action sociale sans hébergement",
  "90": "Activités créatives, artistiques et de spectacle", "91": "Bibliothèques, musées et autres activités culturelles",
  "92": "Organisation de jeux de hasard", "93": "Activités sportives, récréatives et de loisirs",
  "94": "Activités des organisations associatives", "95": "Réparation d'ordinateurs et de biens personnels",
  "96": "Autres services personnels", "97": "Activités des ménages en tant qu'employeurs",
  "98": "Activités indifférenciées des ménages", "99": "Activités extra-territoriales",
};

/**
 * Codes NAF qui ne disent RIEN du métier réel.
 *
 * Un siège social ou une holding porte le code de sa fonction juridique, pas de
 * son activité : « RAS INTERIM JERECRUTE » est en 70.10Z. Pour ces codes, le
 * métier se déduit du nom, du site et des signaux — jamais du NAF.
 */
const OPAQUE_CODES = new Set(["70.10Z", "64.20Z", "64.30Z", "64.99Z", "70.22Z", "82.11Z"]);

export function isOpaqueNaf(code: string | null | undefined): boolean {
  return Boolean(code && OPAQUE_CODES.has(code.toUpperCase().trim()));
}

/** Division à deux chiffres extraite d'un code NAF. */
export function nafDivision(code: string | null | undefined): string {
  return typeof code === "string" ? code.replace(/\D/g, "").slice(0, 2) : "";
}

/** Libellé le plus précis disponible, avec la précision atteinte. */
export function nafLabel(
  code: string | null | undefined,
  sectionLabel?: string | null,
): NafLabel | null {
  if (!code) return null;
  const normalized = code.toUpperCase().trim();
  const division = nafDivision(normalized);

  const exact = SUBCLASS[normalized];
  if (exact) return { label: exact, precision: "sous-classe", division };

  const broad = DIVISION[division];
  if (broad) return { label: broad, precision: "division", division };

  if (sectionLabel) return { label: sectionLabel, precision: "section", division };
  return null;
}
