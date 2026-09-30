/**
 * Ce qu'Axel vend — et ce que le mail en dit.
 *
 * Constat en production : le tri des données et le brief étaient bons, mais le
 * mail final restait impersonnel. On y lisait « Dans le commerce de gros,
 * passer une commande… » — vrai pour n'importe quel négociant — sans jamais
 * savoir qui écrivait, ce qu'il avait déjà construit, ni ce qu'il proposait.
 *
 * La cause était structurelle : la signature, les preuves et la façon de se
 * présenter vivaient en dur dans `lib/persona.ts`. Elles vivent maintenant
 * dans `user_offer`, éditables depuis /offre, et ce module les met en forme
 * pour le rédacteur.
 *
 * Sans dépendance serveur : importable par une page client comme par une route.
 */
import type { EntryOfferType, OfferProof, UserOffer } from "@/types";

/**
 * Lien de la signature : la page d'atterrissage des prospects, SANS paramètres.
 * /pme ne sert qu'à la prospection : ses visites suffisent comme mesure, et un
 * lien court se lit mieux dans un mail en texte brut.
 */
export const SIGNATURE_URL = "https://axelremillat.com/pme";

/**
 * Réservation de la démo de 15 min : le lien Google Agenda du site (prise de
 * rendez-vous). Source : PORTFOLIO_V2, lib/site-config.ts (CALENDAR_URL), utilisé
 * par les boutons « Réserver 15 min ».
 */
export const CALENDAR_URL = "https://calendar.app.google/dwAR7ea7tgAehwv48";

/**
 * Préremplissage, tiré du portfolio public.
 *
 * Rien d'inventé : chaque preuve renvoie à une démo réellement en ligne. Les
 * valeurs sont éditables — c'est un point de départ, pas une vérité figée.
 */
export const OFFER_DEFAULTS: Omit<UserOffer, "user_id" | "created_at" | "updated_at"> = {
  full_name: "Axel Remillat",
  title: "Automatisation & IA pour PME",
  portfolio_url: SIGNATURE_URL,
  // Saisi à la main : on ne devine pas un numéro de téléphone.
  phone: null,
  show_phone: false,

  entry_type: "demo",
  entry_duration: "15 min",
  entry_pitch: "Je peux vous montrer à quoi ça ressemblerait chez vous en 15 minutes.",
  entry_url: CALENDAR_URL,

  lead_time: "2 à 3 semaines",
  no_tool_change: true,
  human_validation: true,

  proofs: [
    {
      id: "n8n",
      title: "5 automatisations testables",
      sentence:
        "5 automatisations testables en direct sur mon site : tri d'e-mails, " +
        "factures, comptes rendus, fichiers clients, SAV.",
      tags: ["e-mails", "factures", "SAV", "comptes rendus", "fichiers clients", "dossiers", "documents", "administratif", "données"],
      url: "https://axelremillat.com/automatisations",
      publicOk: true,
    },
    {
      id: "agent-devis",
      title: "Agent devis (5 métiers)",
      sentence:
        "Un agent qui transforme une demande client en devis chiffré, testable sur mon site " +
        "sur 5 métiers : menuiserie, BTP, négoce B2B, boulangerie-traiteur, services B2B.",
      tags: ["commandes", "devis", "négoce", "demandes clients", "prise de rdv"],
      url: "https://axelremillat.com/agent",
      publicOk: true,
    },
    {
      id: "vega",
      title: "Assistant IA sourcé",
      sentence: "Un assistant IA qui répond avec ses sources, en ligne sur mon site.",
      tags: ["documentation", "recherche", "support", "base de connaissances"],
      url: "https://axelremillat.com/demos",
      publicOk: true,
    },
    {
      id: "scoring",
      title: "Scoring de leads",
      sentence: "Un scoring de leads qui prédit la probabilité de conversion.",
      tags: ["commercial", "prospection", "CRM"],
      url: "https://axelremillat.com/pipeline",
      publicOk: true,
    },
    {
      id: "ionis",
      title: "1er prix IONIS 2025",
      sentence: "1er prix du concours IONIS 2025, sur plus de 400 projets.",
      tags: ["crédibilité"],
      url: null,
      publicOk: true,
    },
  ],
};

/** Preuve de crédibilité : un bonus, jamais un remplacement d'une preuve métier. */
export const CREDIBILITY_PROOF_ID = "ionis";

/** Au-delà, on n'ajoute plus le bonus de crédibilité : le mail est déjà plein. */
export const CREDIBILITY_WORD_BUDGET = 110;

/**
 * Les cinq démos n8n, nommées.
 *
 * Quand le pain tombe sur l'une d'elles, le mail la nomme précisément — « vous
 * pouvez tester le tri d'e-mails en direct sur mon site » — plutôt que de
 * citer la preuve générique. C'est ce qui rend l'offre vérifiable en un clic,
 * et c'est le cas le plus fréquent chez une PME.
 */
export const N8N_DEMOS: { key: string; label: string; tags: string[] }[] = [
  // Tags ETROITS : un pain qui mentionne un e-mail comme simple canal (« le
  // bon arrive par e-mail ») n'est pas un pain de tri d'e-mails. Eval du
  // 28/09/2026 : BRIOL (bons de livraison) et HUMAN SIGHT (onboarding) ont recu
  // « le tri d'e-mails », SELECTION HABITAT (estimations) « les comptes rendus »
  // via « visite » — trois demos hors sujet que le juge a sanctionnees.
  // « Demandes entrantes » en fait partie (BOUVET CARTIER, 30/09/2026) : le pain
  // « qualifier les demandes entrantes et les orienter » EST un tri, et la preuve
  // retombait sur l'énumération des cinq démos faute de mot reconnu.
  { key: "emails", label: "le tri d'e-mails", tags: ["tri des e-mails", "trier les e-mails", "trier les mails", "boîte de réception", "e-mails entrants", "mails entrants", "courrier entrant", "demandes entrantes", "tri des demandes", "trier les demandes", "qualifier les demandes", "orienter les demandes"] },
  { key: "factures", label: "le traitement des factures", tags: ["facture", "facturation", "comptab", "règlement", "impayé"] },
  { key: "sav", label: "le SAV", tags: ["sav", "réclamation", "support", "litige", "après-vente", "service client"] },
  { key: "comptes-rendus", label: "les comptes rendus", tags: ["compte rendu", "compte-rendu", "réunion", "procès-verbal"] },
  { key: "donnees", label: "le nettoyage des fichiers clients", tags: ["doublon", "nettoyage de données", "dédoublonn", "fichier clients", "fichiers clients"] },
];

/**
 * Les 5 métiers de l'agent devis (https://axelremillat.com/agent), reconnus au
 * SECTEUR du prospect (libellé ou code NAF). Source : PORTFOLIO_V2, lib/metiers.
 *
 * Quand le prospect exerce l'un d'eux, la preuve devient vérifiable sur SON cas :
 * « testable sur mon site avec un exemple de votre métier ». On ne lit que le
 * secteur, jamais le pain : « fenêtre » ou « volet » y ont d'autres sens.
 * L'ordre compte : la menuiserie (43.32) passe avant le BTP (43.x), et le
 * nettoyage avant le BTP (« Nettoyage courant des bâtiments » n'est pas du BTP).
 */
export const AGENT_METIERS: { id: string; label: string; pattern: RegExp }[] = [
  { id: "menuiserie", label: "menuiserie / fenêtres", pattern: /menuis|fen[eê]tre|volet|huisser|\b16\.23|\b43\.32/i },
  { id: "boulangerie", label: "boulangerie-traiteur", pattern: /boulang|p[aâ]tiss|traiteur|viennois|\b10\.71|\b56\.21/i },
  { id: "negoce", label: "négoce B2B", pattern: /n[eé]goc|grossiste|commerce de gros|centrale d.achat|\b46\.\d/i },
  {
    id: "services",
    label: "services B2B",
    pattern: /nettoyage|propret[eé]|entretien des locaux|maintenance informatique|infog[eé]rance|services? aux entreprises|\b81\.2|\b62\.03/i,
  },
  {
    id: "btp",
    label: "BTP / rénovation",
    pattern: /b[aâ]timent|\bbtp\b|r[eé]novation|ma[cç]onn|pl[aâ]tr|peinture|carrel|plomb|chauffag|couvert?ure|second [oœ]uvre|gros [oœ]uvre|\b4[13]\.\d/i,
  },
];

/** Phrase de preuve quand le métier du prospect est l'un des 5 de l'agent devis. */
export const AGENT_METIER_SENTENCE =
  "un agent qui transforme une demande client en devis chiffré, testable sur mon site avec un exemple de votre métier";

/** Métier de l'agent devis correspondant au secteur, s'il y en a un. */
export function agentMetier(sector: string | null | undefined): { id: string; label: string } | null {
  const text = (sector ?? "").trim();
  if (!text) return null;
  const found = AGENT_METIERS.find((metier) => metier.pattern.test(text));
  return found ? { id: found.id, label: found.label } : null;
}

export interface OfferView {
  /** `true` quand la page /offre n'a pas encore été remplie. */
  complete: boolean;
  offer: UserOffer;
}

const isFilled = (value: string | null | undefined): boolean => Boolean(value && value.trim());

/**
 * L'offre est-elle exploitable pour écrire un mail ?
 *
 * On exige le minimum qui change le mail : un nom, un titre, une offre
 * d'entrée et au moins une preuve publique. Le reste est du confort.
 */
export function isOfferComplete(offer: Partial<UserOffer> | null | undefined): boolean {
  if (!offer) return false;
  return (
    isFilled(offer.full_name) &&
    isFilled(offer.title) &&
    isFilled(offer.entry_pitch) &&
    (offer.proofs ?? []).some((proof) => proof.publicOk)
  );
}

/**
 * Complète une ligne avec les valeurs par défaut — et SEULEMENT ce qu'il faut.
 *
 * La version précédente filtrait les valeurs `null` de la ligne avant de les
 * superposer aux défauts. Conséquence : tout champ vidé volontairement
 * réapparaissait rempli au rechargement suivant. Axel effaçait un titre, le
 * retrouvait au prochain passage, et n'avait aucun moyen de le vider.
 *
 * La règle est maintenant explicite : **un défaut ne comble qu'une absence, pas
 * un vide choisi**.
 *   - aucune ligne en base → tout vient des défauts (le préremplissage) ;
 *   - clé absente de la ligne → défaut (ligne partielle, cas des tests) ;
 *   - clé présente, même à `null` → la valeur de la ligne gagne, telle quelle.
 */
export function withDefaults(row: Partial<UserOffer> | null | undefined, userId = ""): UserOffer {
  const base: UserOffer = {
    ...OFFER_DEFAULTS,
    user_id: userId,
    created_at: "",
    updated_at: "",
  } as UserOffer;

  if (!row) return base;

  const merged = { ...base };
  for (const [key, value] of Object.entries(row)) {
    // `undefined` seul signifie « la ligne ne dit rien de ce champ ». Un `null`
    // dit « ce champ est vide », et c'est une information qu'on respecte.
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  merged.user_id = row.user_id ?? userId;
  return merged;
}

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Le tag apparait-il dans le texte, au singulier comme au pluriel ?
 *
 * Le tag « commandes » ne trouvait pas « une commande client » : un `includes`
 * brut rate le singulier, et le recoupement echouait donc sur le cas le plus
 * courant. On compare des formes reduites — chaque mot prive de son « s » ou
 * « x » final.
 */
export function tagMatches(tag: string, text: string): boolean {
  const singular = (value: string) =>
    normalize(value)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => (word.length > 3 ? word.replace(/[sx]$/, "") : word))
      .join(" ");

  const needle = singular(tag);
  return needle.length > 2 && singular(text).includes(needle);
}

/**
 * Démo n8n qui correspond au pain, s'il y en a une.
 *
 * On cherche dans le texte du pain, pas dans les tags de la preuve : c'est le
 * besoin du prospect qui décide, pas notre catalogue.
 */
export function matchingDemo(painText: string): { key: string; label: string } | null {
  const found = N8N_DEMOS.find((demo) => demo.tags.some((tag) => tagMatches(tag, painText)));
  return found ? { key: found.key, label: found.label } : null;
}

export interface ProofChoice {
  proof: OfferProof | null;
  /** Phrase à écrire, déjà adaptée si une démo précise a été reconnue. */
  sentence: string | null;
  /** Démo n8n nommée, quand le pain tombe dessus. */
  demo: { key: string; label: string } | null;
  /** Pourquoi cette preuve — affiché dans le brief. */
  reason: string;
}

/**
 * Preuve à mobiliser pour ce pain.
 *
 * Une seule preuve métier par mail. Le recoupement se fait sur les tags ; sans
 * recoupement, on ne cite RIEN — une preuve hors sujet dessert plus qu'elle ne
 * sert, et c'est exactement ce qui est arrivé en production quand un flux
 * d'alertes frigorifiques était cité pour un organisme de formation.
 */
/**
 * Metiers ou « devis » et « commande » ne veulent pas dire ce qu'on croit.
 *
 * Une agence d'interim, un cabinet RH, un organisme de formation ne passent pas
 * de commandes : ils traitent des DOSSIERS — contrats, attestations, releves
 * d'heures, conventions, dossiers de candidature. Leur proposer un agent qui
 * transforme une demande client en devis tombe a cote, et ca se voit. Constate
 * sur ARVE INTERIM le 27/09/2026.
 */
const DOCUMENT_TRADES =
  /int[eé]rim|travail temporaire|mise a disposition|placement|recrutement|ressources humaines|\brh\b|paie|formation|apprentissage|organisme de formation|cabinet de conseil en recrutement/i;

/**
 * Commerces de bouche et restauration : JAMAIS une demo de documents.
 *
 * SARL BONNIN FRERES (boulangerie) a recu la demo « comptes rendus » — une
 * demo RH, hors sujet pour un laboratoire qui alimente des boutiques. Leur
 * sujet est la production et les commandes des magasins ; aucune demo ne le
 * montre, on renvoie donc aux exemples du site.
 */
const FOOD_TRADES =
  /boulang|p[aâ]tiss|viennois|traiteur|restaura|chocolat|glacier|boucher|charcut|fromag|primeur|[eé]picer|brasserie|pizz|\b10\.7|\b56\.10/i;

const CONSULTING = /conseil|int[eé]grat|ing[eé]nierie informatique|programmation informatique|\b70\.2|\b62\.0/i;

/** Repli quand aucune preuve ne recoupe le pain : jamais une demo hors sujet. */
export const GENERIC_PROOF_SENTENCE = "des exemples testables sur mon site";

/** Demo n8n a mobiliser pour ces metiers : des documents, pas des devis. */
const DOCUMENT_DEMO_KEY = "comptes-rendus";

export function chooseProof(
  offer: UserOffer,
  painText: string,
  options: { sector?: string | null } = {},
): ProofChoice {
  const usable = (offer.proofs ?? []).filter(
    (proof) => proof.publicOk && proof.id !== CREDIBILITY_PROOF_ID,
  );

  // PRIORITE 0 : interim, RH, formation → une demo de DOCUMENTS, jamais l'agent
  // devis. Le metier tourne autour de dossiers a constituer et a relancer.
  const trade = `${options.sector ?? ""} ${painText}`;
  const food = FOOD_TRADES.test(trade);
  // Un cabinet de conseil ou un integrateur n'est pas un metier de dossiers :
  // l'angle est un renfort sur ses missions (HUMAN SIGHT), pas une demo RH.
  const consulting = CONSULTING.test(options.sector ?? "") && !/recrutement/i.test(options.sector ?? "");
  if (!food && !consulting && DOCUMENT_TRADES.test(trade)) {
    const n8n = usable.find((proof) => proof.id === "n8n");
    if (n8n) {
      // Une demo plus proche du pain l'emporte, tant qu'elle reste une demo de
      // documents : tri d'e-mails, factures, comptes rendus, donnees.
      const closest = matchingDemo(painText);
      const demo =
        closest ?? N8N_DEMOS.find((item) => item.key === DOCUMENT_DEMO_KEY) ?? N8N_DEMOS[0];
      return {
        proof: n8n,
        sentence: `vous pouvez tester ${demo.label} en direct sur mon site`,
        demo: { key: demo.key, label: demo.label },
        reason: "metier de dossiers (interim, RH, formation) : une demo de documents, pas l'agent devis",
      };
    }
  }

  // PRIORITE 1 : devis, demandes clients, rendez-vous → l'agent devis. Il fait
  // exactement ce que decrit le pain. « Commande » SEUL ne suffit pas : les
  // commandes de boutiques vers un laboratoire ne sont pas des devis. Une
  // COMMANDE CLIENT (negoce, TERDICI), elle, est bien une demande client.
  /*
   * RÉASSORT ET STOCK NE SONT PAS DES DEVIS.
   *
   * Sur GLOBAL 2F, le pain était « transmettre les besoins de réassort et
   * suivre leur passage en commande fournisseur » : le mot « commande » suffisait
   * à sortir l'agent devis, qui transforme une demande CLIENT en devis. Deux
   * métiers différents, et ça se voit à la lecture.
   */
  // Approvisionnement : jamais l'agent devis, quel que soit le métier.
  const SUPPLY_TAGS = [
    "reassort",
    "réassort",
    "approvisionnement",
    "inventaire",
    "commande fournisseur",
    // Préparer PHYSIQUEMENT les commandes (picking) n'est pas traiter une demande client.
    "préparation de commande",
    "préparation des commandes",
    "préparer les commandes",
  ];
  const aboutSupply = SUPPLY_TAGS.some((tag) => tagMatches(tag, painText));
  const aboutStock = aboutSupply || tagMatches("stock", painText);

  /*
   * Synonymes d'une demande client à chiffrer ou à confirmer. ARTFLEX
   * (520644386, négoce de robinetterie) : « préparer la confirmation de
   * commande et du délai » ne contenait aucun des mots attendus, et la preuve
   * n'était pas l'agent devis.
   */
  const ORDER_TAGS = [
    "devis",
    "pré-devis",
    "demande client",
    "commande client",
    "confirmation de commande",
    "demande de prix",
    "demande de cotation",
    "cotation",
    "offre de prix",
    "chiffrage",
    "chiffrer",
    "prise de rdv",
    "rendez-vous",
  ];
  // Négoce B2B : une COMMANDE y est une demande client (référence, quantité,
  // délai, prix) — exactement ce que montre l'agent, métier « Négoce B2B »,
  // qui vérifie aussi le STOCK avant de confirmer. ARTFLEX, eval du 30/09 :
  // « vérifier la disponibilité dans les deux stocks avant de confirmer la
  // commande » excluait l'agent au mot « stock », et la preuve devenait un
  // scoring de leads hors sujet. Seul l'APPROVISIONNEMENT l'exclut ici.
  const negoce = agentMetier(options.sector)?.id === "negoce";
  const tradeOrder =
    negoce && !aboutSupply && (tagMatches("commande", painText) || tagMatches("confirmation", painText));
  if (tradeOrder || (!aboutStock && ORDER_TAGS.some((tag) => tagMatches(tag, painText)))) {
    const agent = usable.find((proof) => proof.id === "agent-devis");
    if (agent) {
      // Métier du prospect parmi les 5 de l'agent : la démo se teste sur SON métier.
      const metier = agentMetier(options.sector);
      if (metier) {
        return {
          proof: agent,
          sentence: AGENT_METIER_SENTENCE,
          demo: { key: `agent-${metier.id}`, label: `l'agent devis, métier ${metier.label}` },
          reason: `le pain porte sur des devis et le métier (${metier.label}) est l'un des 5 de l'agent : testable sur son métier`,
        };
      }
      return {
        proof: agent,
        sentence: agent.sentence,
        demo: null,
        reason: "le pain porte sur des commandes ou des devis : l'agent devis est le plus proche",
      };
    }
  }

  // Commerce de bouche sans devis : les exemples du site, rien de plus.
  if (food) return genericProof("commerce de bouche : aucune demo de documents, les exemples du site");

  // PRIORITE 2 : e-mails, documents, factures, SAV, comptes rendus → la demo
  // n8n correspondante, NOMMEE.
  const demo = matchingDemo(painText);
  if (demo) {
    const n8n = usable.find((proof) => proof.id === "n8n");
    if (n8n) {
      return {
        proof: n8n,
        sentence: `vous pouvez tester ${demo.label} en direct sur mon site`,
        demo,
        reason: `le pain correspond à la démo « ${demo.label} » : on la nomme précisément`,
      };
    }
  }

  // L'agent devis ne sort QUE par la priorite 1 : ses tags (« commande »…)
  // l'attribuaient a des pains de commandes qui ne sont pas des devis.
  const matched = usable.find(
    (proof) => proof.id !== "agent-devis" && proof.tags.some((tag) => tagMatches(tag, painText)),
  );
  if (matched) {
    /*
     * UNE SEULE DÉMO, JAMAIS L'ÉNUMÉRATION.
     *
     * La phrase de la preuve n8n liste les cinq démos (« tri d'e-mails,
     * factures, comptes rendus… ») : citée telle quelle, elle faisait de la
     * preuve un catalogue (BOUVET CARTIER). Sans démo précise pour ce pain, on
     * s'en tient aux exemples du site.
     */
    if (matched.id === "n8n") {
      return genericProof("tags recoupés sans démo précise : les exemples du site, jamais l'énumération des cinq démos");
    }
    return {
      proof: matched,
      sentence: matched.sentence,
      demo: null,
      reason: `tags recoupés : ${matched.tags.filter((tag) => tagMatches(tag, painText)).join(", ")}`,
    };
  }

  return genericProof("aucune preuve ne recoupe le pain : les exemples du site, jamais une demo hors sujet");
}

function genericProof(reason: string): ProofChoice {
  return { proof: null, sentence: GENERIC_PROOF_SENTENCE, demo: null, reason };
}

/** La preuve de crédibilité tient-elle encore dans le mail ? */
export function credibilityFits(offer: UserOffer, wordCount: number): OfferProof | null {
  if (wordCount > CREDIBILITY_WORD_BUDGET) return null;
  return (offer.proofs ?? []).find((proof) => proof.id === CREDIBILITY_PROOF_ID && proof.publicOk) ?? null;
}

/**
 * Signature, telle qu'elle est ajoutée sous le mail.
 *
 * Elle n'est PAS comptée dans les mots : c'est une carte de visite, pas du
 * corps. Elle remplace le « Axel » seul qui partait jusqu'ici.
 */
export function signatureFor(offer: UserOffer): string {
  const line = [offer.title, offer.portfolio_url, offer.show_phone ? offer.phone : null]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");
  return [offer.full_name?.trim() || "Axel Remillat", line].filter(Boolean).join("\n");
}

/** Libellé lisible de l'offre d'entrée : « une démo de 15 min ». */
export function entryOfferLabel(offer: UserOffer): string | null {
  const labels: Record<EntryOfferType, string> = {
    demo: "une démo",
    appel: "un appel découverte",
    audit: "un audit",
    pilote: "un pilote",
  };
  if (!offer.entry_type) return null;
  const base = labels[offer.entry_type];
  return offer.entry_duration ? `${base} de ${offer.entry_duration}` : base;
}

/** Ce que le mail peut promettre, en clair. */
export function promiseLines(offer: UserOffer): string[] {
  return [
    offer.lead_time ? `mise en place type : ${offer.lead_time}` : null,
    offer.no_tool_change ? "sans changer d'outil" : null,
    offer.human_validation ? "validation humaine avant chaque action" : null,
  ].filter((line): line is string => Boolean(line));
}
