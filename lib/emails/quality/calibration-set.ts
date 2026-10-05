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
