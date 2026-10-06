/**
 * JEU DE RÉFÉRENCE du juge (calibrage, 05/10/2026).
 *
 * POSITIFS : les mails validés par Axel le 05/10 (programmés ou validés tels
 * quels, sans retouche), plus GRAPHIC PROCEDE, noté 8 par le juge alors
 * qu'Axel le juge envoyable (« peut retarder » n'est pas une hypothèse
 * bloquante). Le juge DOIT les noter 9 ou plus.
 *
 * NÉGATIFS : défauts de FOND que les règles du code ne voient pas (aucun fait
 * propre, proposition hors sujet, flatterie, conséquence abstraite, défaut
 * affirmé comme un fait, jargon), plus l'étalonnage historique sous 9. Le juge
 * DOIT les noter sous 9 : c'est le garde-fou contre un juge assoupli.
 *
 * Vérification payante (quelques centimes) : `npm run calibrate:judge`.
 */

export interface ReferenceMail {
  company: string;
  subject: string;
  hook: string;
  proposal: string;
  why?: string;
}

export const VALIDATED_POSITIVES: ReferenceMail[] = [
  {
    company: "GATINE",
    subject: "Qui trie vos demandes ?",
    hook: "Entre tubes, bouchons et embouts en carton ou plastique, les demandes reçues par e-mail portent sur des références variées. Un message mal aiguillé retarde la réponse au client.",
    proposal: "J'automatise ce type de tâche pour des PME : les e-mails reçus sont triés entre demandes de devis et commandes, puis transmis à la bonne personne pour préparer la réponse.",
  },
  {
    company: "NORDISK CLEAN SOLUTIONS SARL",
    subject: "Vos confirmations de délai ?",
    hook: "Entre lave-vaisselle et lave-ustensiles professionnels, chaque commande exige d’identifier les bonnes références. Avant la confirmation du délai, le client attend une réponse.",
    proposal: "J'automatise ce type de tâche pour des PME : chaque commande reçue par e-mail est préremplie dans votre outil, avec une confirmation de délai prête à valider.",
  },
  {
    company: "CASTE ING",
    subject: "Relances des factures clients",
    hook: "Entre l’administration de parcs d’ascenseurs et les missions de contrôle, les factures clients portent sur des prestations différentes. Une échéance passée sans règlement appelle une relance adaptée aux échanges déjà tenus avec le client.",
    proposal: "J'automatise ce type de tâche pour des PME : les factures arrivées à échéance sont repérées, une relance tenant compte des échanges précédents est préparée et le paiement à suivre vous est signalé.",
  },
  {
    company: "THIBAULT BERGERON SAS",
    subject: "Qui trie vos commandes reçues ?",
    hook: "Avec des emballages en carton sur mesure pour les chocolatiers et pâtissiers, chaque commande appelle une vérification des références. Une disponibilité signalée trop tard retarde la confirmation au client.",
    proposal: "J'automatise ce type de tâche pour des PME : les commandes reçues par e-mail sont triées et leurs références et quantités mises en évidence pour vérifier la disponibilité.",
  },
  {
    company: "CAREA SANITAIRE",
    subject: "Devis cuisine",
    hook: "Chez Carea, les rendez-vous conseil cuisine portent notamment sur les plans de travail et les éviers. Après l'échange, le client attend son devis pour avancer dans son projet.",
    proposal: "J'automatise ce type de tâche pour des PME : les références et les dimensions convenues alimentent un devis préparé pour votre validation, afin que le client reçoive sa proposition plus vite.",
  },
  {
    company: "FONDERIE DE LA BRUCHE",
    subject: "Vos confirmations de délai ?",
    hook: "Entre usinage, assemblage et contrôle d’étanchéité, chaque commande doit préciser les prestations attendues. Une finition non précisée retarde la confirmation du délai.",
    proposal: "J'automatise ce type de tâche pour des PME : les demandes et commandes reçues par e-mail sont triées, et les informations manquantes signalées avant que votre équipe confirme le délai.",
  },
  {
    company: "ESPACE 3000",
    subject: "Vos réponses après-vente en attente ?",
    hook: "Avec 30 concessions et la prise de rendez-vous après-vente en ligne, chaque demande client appelle une réponse claire. Une réponse oubliée laisse le client sans confirmation.",
    proposal: "J'automatise ce type de tâche pour des PME : les e-mails reçus sont triés et une réponse adaptée à chaque demande après-vente est préparée pour votre validation.",
  },
  {
    company: "GRAPHIC PROCEDE",
    subject: "Vos factures après livraison ?",
    hook: "Avec vos impressions numériques tous formats, chaque commande livrée comporte des références à reporter sur la facture. Cette ressaisie peut retarder son envoi au client.",
    proposal: "J'automatise ce type de tâche pour des PME : les références des commandes livrées servent à préparer les factures, et les échéances sans règlement enregistré sont signalées pour relance.",
  },
  {
    company: "LE PAIN DE BELLEDONNE",
    subject: "Commandes en restauration",
    hook: "Avec quatre fournils et des clients en restauration, chaque commande doit rejoindre le bon planning avant confirmation du délai. Un délai confirmé tard laisse le client dans l’attente.",
    proposal: "J'automatise ce type de tâche pour des PME : les commandes reçues par e-mail alimentent votre suivi, et une confirmation du délai est préparée pour validation avant envoi.",
  },
  {
    company: "MAVIFLEX",
    subject: "Confirmation des commandes",
    hook: "Avec des portes industrielles sur mesure, chaque commande appelle une confirmation de délai. Une confirmation en attente laisse le client sans date.",
    proposal: "J'automatise ce type de tâche pour des PME : les demandes et commandes reçues par e-mail sont triées, et un brouillon de confirmation est préparé pour votre validation.",
  },
  {
    company: "AKTID",
    subject: "Délais des commandes fournisseurs",
    hook: "Avec 200 installations réalisées, le suivi des commandes fournisseurs compte dans la préparation de chaque projet. Tant qu’une date de livraison reste à confirmer, le planning ne peut pas être arrêté.",
    proposal: "J'automatise ce type de tâche pour des PME : les confirmations reçues par e-mail renseignent le suivi des achats, et les commandes sans réponse sont signalées pour relance.",
  },
];

export const FOND_NEGATIVES: ReferenceMail[] = [
  {
    company: "GÉNÉRIQUE SECTEUR",
    subject: "Vos demandes",
    hook: "Les entreprises comme la vôtre reçoivent chaque jour de nombreuses demandes. Une demande oubliée retarde la réponse au client.",
    proposal: "J'automatise ce type de tâche pour des PME : les e-mails reçus sont triés et les demandes à traiter vous sont signalées.",
    why: "Aucun fait propre : la phrase vaut pour n'importe quelle entreprise.",
  },
  {
    company: "PROPOSITION HORS SUJET",
    subject: "Devis de menuiserie",
    hook: "Entre fenêtres sur mesure, volets et portes de garage, chaque devis demande des cotes précises. Un devis qui part tard laisse le client chercher ailleurs.",
    proposal: "J'automatise ce type de tâche pour des PME : les niveaux de stock sont suivis et les commandes fournisseurs préparées pour votre validation.",
    why: "La proposition (stock) ne répond pas à la tâche de l'accroche (devis).",
  },
  {
    company: "FLATTERIE",
    subject: "Votre savoir-faire",
    hook: "Votre savoir-faire remarquable en charpente traditionnelle fait votre excellente réputation. Vos clients exigeants méritent des réponses rapides.",
    proposal: "J'automatise ce type de tâche pour des PME : les demandes reçues par e-mail sont triées et une réponse est préparée pour votre validation.",
    why: "Flatterie et superlatifs, aucune conséquence observable.",
  },
  {
    company: "CONSÉQUENCE ABSTRAITE",
    subject: "Vos commandes",
    hook: "Entre farines bio et levains, chaque commande de boulangerie demande de l'attention. Cela a des conséquences sur l'organisation.",
    proposal: "J'automatise ce type de tâche pour des PME : les commandes reçues par e-mail sont triées et inscrites dans votre suivi.",
    why: "Conséquence abstraite (« a des conséquences sur l'organisation »), rien d'observable.",
  },
  {
    company: "ACCUSATION",
    subject: "Vos clients attendent",
    hook: "Entre chaudières et pompes à chaleur, vos clients se plaignent souvent de vos délais de réponse. Vos techniciens perdent des demandes d'intervention.",
    proposal: "J'automatise ce type de tâche pour des PME : les demandes d'intervention reçues par e-mail sont triées et le planning proposé pour validation.",
    why: "Affirme comme un FAIT un défaut du prospect (clients qui se plaignent, demandes perdues) : invérifiable et blessant.",
  },
  {
    company: "JARGON",
    subject: "Centralisation des données",
    hook: "Entre transport frigorifique et entreposage, vos informations circulent entre plusieurs outils. La traçabilité de bout en bout reste partielle.",
    proposal: "J'automatise ce type de tâche pour des PME : l'intégration centralisée de vos données garantit une traçabilité de bout en bout et une meilleure efficacité opérationnelle.",
    why: "Jargon (« intégration centralisée », « efficacité opérationnelle »), aucun geste concret.",
  },
];

/**
 * FAMILLES F2 et F4 — cas RÉELS relus par Cowork et Axel le 05/10/2026 (notés
 * 10/10 à tort), et leur réécriture attendue. Le juge doit noter les originaux
 * sous 9 et les réécritures 9 ou plus ; les règles du code attrapent déjà le
 * passif (F2) et la démo présentée comme faite sur leur métier (F4).
 */
export interface FamilyReference {
  family: "F2" | "F4";
  company: string;
  subject: string;
  hook: string;
  proposal: string;
  /** Ce que l'on sait d'eux (vu par le juge). */
  facts: string;
  expected: "positif" | "négatif";
  why: string;
}

const AIRPLANE_FACTS = "- Activité (leur site) : maintenance en base, peinture aéronautique, équipements et pièces détachées pour avions régionaux";
const DUPONT_FACTS = "- Activité (leur site) : fabrication et vente de vêtements professionnels et de vêtements de travail pour différents secteurs";

export const FAMILY_REFERENCES: FamilyReference[] = [
  {
    family: "F2",
    company: "AIRPLANE DELIVERY",
    subject: "Demandes de pièces",
    hook: "En maintenance d'avions régionaux, vérifier les pièces disponibles et suivre les délais fournisseurs revient souvent, avec une intervention qui attend.",
    proposal: "Concrètement, les demandes de pièces reçues par e-mail sont triées, puis une commande fournisseur est préparée pour votre validation.",
    facts: AIRPLANE_FACTS,
    expected: "négatif",
    why: "Tournure lourde, proposition au passif.",
  },
  {
    family: "F2",
    company: "AIRPLANE DELIVERY",
    subject: "Demandes de pièces",
    hook: "Pour une entreprise de maintenance et de pièces détachées d'avions régionaux, chaque demande de pièce oblige à vérifier le stock et les délais fournisseurs. Une réponse tardive retarde l'intervention.",
    proposal: "Je mets en place le tri de vos demandes de pièces : la commande fournisseur est prête à valider dès la demande reçue.",
    facts: AIRPLANE_FACTS,
    expected: "positif",
    why: "Activité sourcée, phrases simples, première personne.",
  },
  {
    family: "F4",
    company: "DUPONT-BEAUDEUX",
    subject: "Factures clients",
    hook: "Elle lit une commande de vêtements professionnels et prépare la facture client à valider.",
    proposal: "",
    facts: DUPONT_FACTS,
    expected: "négatif",
    why: "Laisse croire que la démo a été faite sur leur métier.",
  },
  {
    family: "F4",
    company: "DUPONT-BEAUDEUX",
    subject: "Factures clients",
    hook: "Elle lit une commande type et prépare la facture à valider ; le même principe s'appliquerait à vos commandes de vêtements professionnels, facturées dès la livraison.",
    proposal: "",
    facts: DUPONT_FACTS,
    expected: "positif",
    why: "Démo honnête : cas type, puis transposition.",
  },
];

/**
 * MAILS RÉELS DU 06/10/2026 NOTÉS PAR COWORK (grille « 9–10 réels ») : sous 9
 * sauf la version d'ANTARES réécrite. Le double juge (grille de la famille +
 * relecteur senior) doit retrouver ce partage : < 9 pour les premiers, ≥ 9
 * pour le dernier positif. Corps tels qu'envoyés ou validés.
 */
export interface GradedMail {
  family: "F1" | "F2" | "F3" | "F4";
  company: string;
  subject: string;
  greeting: string;
  hook: string;
  proposal: string;
  demo: "devis" | "emails" | "factures" | "sav" | "general";
  coworkScore: number;
}

export const COWORK_GRADED: GradedMail[] = [
  {
    family: "F4",
    company: "SA SOPRIMA INDUSTRIE",
    subject: "Demandes de devis",
    greeting: "Bonjour Monsieur Burgun,",
    hook: "Elle lit une demande type et prépare un brouillon de devis à valider ; le même principe s'appliquerait à vos demandes de devis pour l’application de produits de freinage et d’étanchéité.",
    proposal: "",
    demo: "devis",
    coworkScore: 8,
  },
  {
    family: "F3",
    company: "PLIMETAL",
    subject: "Qui prépare vos demandes de devis ?",
    greeting: "Bonjour,",
    hook: "Qui prépare les demandes de devis reçues par e-mail pour votre bureau d’étude ?",
    proposal: "J’automatise la lecture des e-mails et pièces jointes, le préremplissage des demandes et le signalement des informations manquantes.",
    demo: "emails",
    coworkScore: 8,
  },
  {
    family: "F4",
    company: "ARIC S.A.",
    subject: "Demandes d’étude d’éclairage",
    greeting: "Bonjour Monsieur Daric,",
    hook: "Elle lit une demande type et prépare un brouillon de réponse à valider ; le même principe s’appliquerait à vos demandes d’étude d’éclairage.",
    proposal: "",
    demo: "emails",
    coworkScore: 7.5,
  },
  {
    family: "F1",
    company: "BULLY- LES CARS JURASSIENS",
    subject: "Demandes de devis",
    greeting: "Bonjour Madame,",
    hook: "Avec les transports à la carte et les demandes de devis en ligne, chaque trajet nécessite des informations précises. Un détail manquant retarde l'envoi du devis au client.",
    proposal: "J'automatise ce type de tâche pour des PME : les demandes en ligne alimentent votre outil de devis, les informations manquantes sont signalées et une relance est préparée en l'absence de réponse.",
    demo: "devis",
    coworkScore: 7.5,
  },
  {
    family: "F1",
    company: "CAMEL DIAM",
    subject: "Demandes de devis",
    greeting: "Bonjour Monsieur Branquart,",
    hook: "Avec une liste de mobilier pour crèches à sélectionner en ligne, chaque demande de devis réunit plusieurs références à vérifier. Un devis qui part tard laisse le client attendre.",
    proposal: "J'automatise ce type de tâche pour des PME : les références d'une demande sont relevées et un devis personnalisé est préparé pour votre validation.",
    demo: "devis",
    coworkScore: 7.5,
  },
  // Version réécrite par Cowork (validée par Axel, partie le 06/10) : POSITIF, 9.
  {
    family: "F3",
    company: "ANTARES-FRANCE",
    subject: "Qui classe les documents clients ?",
    greeting: "Bonjour Monsieur,",
    hook: "Qui trie et classe les documents qui accompagnent vos commandes clients ?",
    proposal: "J'automatise ce classement : chaque document reçu est lu, rangé dans le bon dossier et les informations manquantes sont signalées avant validation.",
    demo: "emails",
    coworkScore: 9,
  },
  // Version d'origine (reconstituée d'après la relecture de Cowork : double sens, lourdeur, lien générique) : NÉGATIF, 6.
  {
    family: "F3",
    company: "ANTARES-FRANCE",
    subject: "Qui gère vos pièces administratives ?",
    greeting: "Bonjour Monsieur,",
    hook: "Qui gère les pièces administratives de vos commandes de pièces mécaniques ?",
    proposal: "J'automatise le tri des documents des dossiers de pièces de précision et leur classement.",
    demo: "general",
    coworkScore: 6,
  },
];
