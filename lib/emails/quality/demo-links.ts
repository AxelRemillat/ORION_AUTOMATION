/**
 * PREUVE — UNE démo adaptée au pain, avec son URL.
 *
 * « Des exemples testables sur mon site » sans lien ne prouve rien : le 03/10,
 * Axel a noté ~5/10 des mails qui s'arrêtaient là. Le mail porte désormais une
 * ligne « Exemple testable en une minute : <url> », posée par le CODE (le
 * modèle ne l'écrit pas, il ne peut donc ni l'inventer ni la déformer).
 *
 * URL VÉRIFIÉES sur axelremillat.com le 03/10/2026 (HTTP 200, dépôt
 * PORTFOLIO_V2) :
 *   - /agent : agent devis ; le visiteur choisit son métier sur la page
 *     (menuiserie, BTP, négoce, boulangerie-traiteur, services). Il n'existe
 *     PAS de route /agent/<métier> (404) ni de paramètre de métier ;
 *   - /automatisations?demo=<id> ouvre directement l'onglet de la démo
 *     (components/preuves/demo/AutomationTabs.tsx lit `?demo=`) :
 *     email (tri des e-mails), meeting (compte rendu), dataclean (fichier
 *     clients), invoice (facture), sav (service client) ;
 *   - /automatisations : toutes les démos, en repli.
 *
 * Écrites sans « https:// », comme dans le mail de référence : les messageries
 * les rendent cliquables, et la ligne reste lisible.
 */

export const DEMO_HOST = "axelremillat.com";

export interface DemoLink {
  key: "devis" | "emails" | "factures" | "reporting" | "fichier" | "sav" | "general";
  label: string;
  path: string;
}

export const DEMO_LINKS: Record<DemoLink["key"], DemoLink> = {
  devis: { key: "devis", label: "agent devis", path: "/agent" },
  emails: { key: "emails", label: "tri des demandes et commandes reçues par e-mail", path: "/automatisations?demo=email" },
  factures: { key: "factures", label: "traitement des factures", path: "/automatisations?demo=invoice" },
  reporting: { key: "reporting", label: "compte rendu automatique", path: "/automatisations?demo=meeting" },
  fichier: { key: "fichier", label: "nettoyage du fichier clients", path: "/automatisations?demo=dataclean" },
  sav: { key: "sav", label: "réponses du service client", path: "/automatisations?demo=sav" },
  general: { key: "general", label: "démos d'automatisation", path: "/automatisations" },
};

/** Toutes les URL qu'un mail peut porter : le validateur refuse les autres. */
/**
 * Cowork #40 (CEMA) : /agent est une démo de devis CLIENT. Un problème qui porte sur des devis, commandes ou
 * confirmations FOURNISSEURS se démontre par les factures/commandes (demo=invoice) ou le tri des e-mails.
 */
export const SUPPLIER_SIDE = /(devis|commandes?|confirmations?|bons? de commande|achats?)\s+(de\s+|des\s+|du\s+|aux\s+)?(vos\s+)?fournisseurs?|fournisseurs?\s+(sans|qui|dont)\b/i;

export function demoForSupplierSide(text: string, chosen: DemoLink): DemoLink {
  if (chosen.key !== "devis" || !SUPPLIER_SIDE.test(text)) return chosen;
  return /factur/i.test(text) ? DEMO_LINKS.factures : DEMO_LINKS.emails;
}

export const ALLOWED_DEMO_URLS = Object.values(DEMO_LINKS).map((link) => `${DEMO_HOST}${link.path}`);

export const demoUrl = (link: DemoLink) => `${DEMO_HOST}${link.path}`;

/**
 * Table pain → démo, dans l'ordre de priorité. Le premier motif qui recoupe le
 * pain gagne : un devis passe avant une commande (« demande de prix »).
 */
const TABLE: { key: DemoLink["key"]; pattern: RegExp }[] = [
  { key: "devis", pattern: /devis|chiffrag|chiffrer|demande(s)? de prix|cotation|pré-?devis|métré/i },
  { key: "sav", pattern: /\bsav\b|après-vente|apres-vente|réclamation|reclamation|service client|retours? client|litige|support/i },
  // « fournisseurs » seul ne suffit pas : confirmer une commande fournisseur n'est pas
  // traiter une facture (AKTID, éval du 03/10).
  { key: "factures", pattern: /factur|relance(s)? de paiement|impayé|impaye|encaissement|règlement|reglement|comptab/i },
  { key: "reporting", pattern: /reporting|compte(s)?[ -]rendus?|tableau de bord|rapport|synthèse|synthese|indicateurs|csv|export/i },
  { key: "fichier", pattern: /doublon|fichier clients?|base clients|nettoyage|dédoublonn|dedoublonn/i },
  { key: "emails", pattern: /commande|tri des|trier|demandes? (entrantes?|reçues?|recues?)|boîte|boite|e-?mails?|mails? entrants?|orienter|qualifier|accueil|réservation|reservation|planning|rendez-vous/i },
];

export function demoFor(painText: string): DemoLink {
  const found = TABLE.find((row) => row.pattern.test(painText));
  return DEMO_LINKS[found?.key ?? "general"];
}

/**
 * Démo d'après l'ACTION de la phrase « J'automatise… », pas d'après un mot.
 *
 * SPI ENERGIE (04/10) : « les e-mails de demande de devis sont triés et
 * orientés vers la bonne personne » — la phrase parle de TRIER, pas de
 * préparer un devis ; le mot « devis » envoyait pourtant vers l'agent devis.
 * Préparer, rédiger, chiffrer un devis → agent devis ; trier, orienter,
 * aiguiller, classer → démo e-mails ; sinon la table habituelle.
 */
const QUOTE_ACTION = /(pr[ée]par|r[ée]dig|chiffr|[ée]tabli|transform|g[ée]n[èe]r)\w*[^.]{0,50}\bdevis\b|\bdevis\b[^.]{0,30}\b(pr[êe]ts?|pr[ée]par[ée]s?|chiffr[ée]s?)\b/i;
const SORT_ACTION = /\b(tri[ée]e?s?|trier|orient[ée]e?s?|orienter|aiguill\w*|class[ée]e?s?|classer|r[ée]parti\w*)\b/i;

export function demoForProposal(proposal: string): DemoLink {
  if (QUOTE_ACTION.test(proposal)) return DEMO_LINKS.devis;
  if (SORT_ACTION.test(proposal)) return DEMO_LINKS.emails;
  return demoFor(proposal);
}
