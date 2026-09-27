/**
 * Y a-t-il de quoi écrire une accroche, ou faut-il d'abord nourrir la fiche ?
 *
 * Constat en production : TERDICI VEGETAL n'a ni signal daté ni contenu de
 * site. Le stratège tombait alors sur l'angle « métier » — le plus faible — et
 * le rédacteur se rabattait sur ce qui restait : l'effectif, le code NAF, la
 * société mère. Le juge notait la spécificité 1 ou 2 sur 5, à raison : la
 * première phrase restait vraie pour n'importe quel concurrent.
 *
 * Générer quand même coûtait trois appels de modèle pour produire un mail
 * qu'on ne peut pas envoyer. Mieux vaut le dire : « à nourrir ».
 *
 * La décision est prise ICI, sur les faits, avant tout appel payant.
 */
import type { DerivedFact } from "./derived-facts";

/**
 * Faits qui ne peuvent PAS porter une accroche.
 *
 * Ce sont des faits de CIBLAGE : ils servent à décider si on écrit et à qui,
 * jamais à ouvrir le mail. Un « représentée par J.DIS » ou un « filiale du
 * groupe STEF » dit quelque chose de la structure, rien du moment.
 */
const TARGETING_ONLY = new Set([
  "naf",
  /*
   * LE FAIT DE SITE N'OUVRE PLUS UN MAIL.
   *
   * Il y etait autorise : ce que l'entreprise dit d'elle-meme semblait un point
   * de depart legitime. Deux constats l'ont contredit, sur MAISONS TERRE D'OC
   * le 27/09/2026 :
   *
   *   - la fiche n'avait AUCUN signal date, et le mail est parti quand meme,
   *     porte par ce seul fait de site ;
   *   - ce « fait de site » venait en realite de l'extrait du registre (son
   *     `site_status` valait « non trouve »), et le mail ouvrait sur « votre
   *     presentation relie l'etude… » — une paraphrase de leur objet social.
   *
   * Une accroche doit dire quelque chose que le lecteur ne sait pas deja de
   * lui-meme. Sans evenement date, la fiche est a nourrir.
   */
  "site_offer",
  "site_customers",
  "site_vocabulary",
  // Une adresse de site n'est pas une accroche : c'est une coordonnee. La
  // sonde reelle sur TERDICI VEGETAL passait le gating grace a elle seule.
  "website",
  "family",
  "city",
  "size_range",
  "headcount",
  "revenue",
  "net_income",
  "revenue_per_head",
  "age",
  "leader",
  "contact",
  "parent_group",
  "group_signal",
  // Un mouvement de capital est un fait de STRUCTURE, et son sens n'est pas
  // publie. Il ne porte jamais l'accroche (cf. derived-facts).
  "capital_move",
]);

/**
 * Faits qui datent un EVENEMENT, et peuvent donc ouvrir un mail.
 *
 * Le signal web n'etait pas seul : une ouverture d'etablissement et l'arrivee
 * d'un dirigeant sont datees par le registre, donc plus sures qu'un article.
 * Les trois partagent la meme regle — la date doit etre la, et fraiche.
 */
export const DATED_EVENT_KEYS: ReadonlySet<string> = new Set(["signal", "opening", "new_leader"]);

export interface HookReadiness {
  /** `true` quand au moins un fait peut porter l'accroche. */
  ready: boolean;
  /** Faits capables d'ouvrir le mail, les meilleurs d'abord. */
  strong: DerivedFact[];
  /** Phrase affichée dans l'UI quand ce n'est pas prêt. */
  reason: string;
}

/**
 * Un fait peut-il ouvrir le mail ?
 *
 * Deux familles l'autorisent : un SIGNAL daté et frais (l'actualité de
 * l'entreprise), et un fait tiré de son SITE (ce qu'elle dit elle-même de son
 * activité). Tout le reste est du registre, donc du ciblage.
 */
export function canOpenMail(fact: DerivedFact): boolean {
  if (TARGETING_ONLY.has(fact.key)) return false;
  // Un événement non daté ou périmé ne prouve rien sur l'instant présent.
  if (DATED_EVENT_KEYS.has(fact.key)) return fact.fresh === true;
  return true;
}

export function hookReadiness(facts: readonly DerivedFact[]): HookReadiness {
  const strong = facts.filter(canOpenMail).sort((a, b) => a.hookTier - b.hookTier);
  if (strong.length > 0) {
    return { ready: true, strong, reason: "" };
  }

  const hasStaleSignal = facts.some((fact) => DATED_EVENT_KEYS.has(fact.key) && fact.fresh !== true);
  return {
    ready: false,
    strong: [],
    reason: hasStaleSignal
      ? "À nourrir : aucun signal daté — les signaux trouvés n'ont pas de date exploitable."
      : "À nourrir : aucun événement daté sur cette fiche (signal, ouverture, arrivée d'un dirigeant).",
  };
}

/**
 * Mention portée par un brouillon produit malgré l'absence d'accroche forte.
 *
 * Il reste utile — on peut l'éditer, s'en servir de base — mais il ne doit
 * jamais partir tel quel sans qu'on sache pourquoi il est faible.
 */
export const GENERIC_DRAFT_LABEL = "générique";
