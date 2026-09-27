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
 * Préremplissage, tiré du portfolio public.
 *
 * Rien d'inventé : chaque preuve renvoie à une démo réellement en ligne. Les
 * valeurs sont éditables — c'est un point de départ, pas une vérité figée.
 */
export const OFFER_DEFAULTS: Omit<UserOffer, "user_id" | "created_at" | "updated_at"> = {
  full_name: "Axel Remillat",
  title: "Automatisation & IA en production pour PME",
  portfolio_url: "https://axelremillat.com",
  // Saisi à la main : on ne devine pas un numéro de téléphone.
  phone: null,
  show_phone: false,

  entry_type: "demo",
  entry_duration: "15 min",
  entry_pitch: "Je peux vous montrer à quoi ça ressemblerait chez vous en 15 minutes.",
  entry_url: "https://axelremillat.com/contact",

  lead_time: "2 à 3 semaines",
  no_tool_change: true,
  human_validation: true,

  proofs: [
    {
      id: "n8n",
      title: "5 automatisations métier testables",
      sentence:
        "5 automatisations métier testables en direct sur mon site : tri d'e-mails, " +
        "factures, SAV, comptes rendus, nettoyage de données.",
      tags: ["e-mails", "factures", "SAV", "comptes rendus", "dossiers", "documents", "administratif", "données"],
      url: "https://axelremillat.com/automatisations",
      publicOk: true,
    },
    {
      id: "agent-devis",
      title: "Agent demande → devis",
      sentence:
        "Un agent qui transforme une demande client en devis, réponse et créneau, " +
        "testable sur mon site.",
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
  { key: "emails", label: "le tri d'e-mails", tags: ["e-mail", "mail", "boîte", "message", "courrier"] },
  { key: "factures", label: "le traitement des factures", tags: ["facture", "facturation", "comptab", "règlement", "impayé"] },
  { key: "sav", label: "le SAV", tags: ["sav", "réclamation", "support", "litige", "après-vente", "service client"] },
  { key: "comptes-rendus", label: "les comptes rendus", tags: ["compte rendu", "compte-rendu", "réunion", "visite", "rapport"] },
  { key: "donnees", label: "le nettoyage de données", tags: ["donnée", "doublon", "fichier", "base", "saisie", "ressaisie"] },
];

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
  if (DOCUMENT_TRADES.test(trade)) {
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

  // PRIORITE 1 : commandes, devis, demandes clients → l'agent devis. Il fait
  // exactement ce que decrit le pain, et le nommer vaut mieux qu'une demo
  // generique de tri de documents.
  const ORDER_TAGS = ["commande", "devis", "demande client", "negoce", "prise de rdv"];
  if (ORDER_TAGS.some((tag) => tagMatches(tag, painText))) {
    const agent = usable.find((proof) => proof.id === "agent-devis");
    if (agent) {
      return {
        proof: agent,
        sentence: agent.sentence,
        demo: null,
        reason: "le pain porte sur des commandes ou des devis : l'agent devis est le plus proche",
      };
    }
  }

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

  const matched = usable.find((proof) => proof.tags.some((tag) => tagMatches(tag, painText)));
  if (matched) {
    return {
      proof: matched,
      sentence: matched.sentence,
      demo: null,
      reason: `tags recoupés : ${matched.tags.filter((tag) => tagMatches(tag, painText)).join(", ")}`,
    };
  }

  return {
    proof: null,
    sentence: null,
    demo: null,
    reason: "aucune preuve ne recoupe le pain : mieux vaut n'en citer aucune",
  };
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
