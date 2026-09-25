/**
 * Lecture d'une annonce BODACC brute.
 *
 * Séparé du client HTTP pour être testable sans réseau : tout ici est une
 * fonction pure qui prend le JSON de l'API et rend une décision.
 *
 * Ce que la structure réelle impose (observé sur 300 annonces du Rhône, 25/09) :
 *
 *   - Il n'y a PAS de colonne `siren`. Il vit dans `registre` (un tableau qui
 *     porte deux écritures du même numéro) et, plus fiablement, dans
 *     `listepersonnes.personne.numeroImmatriculation.numeroIdentification`.
 *   - `commercant` concatène TOUS les noms cités. Sur une cession il vaut
 *     « ACQUEREUR, CEDANT » — inutilisable comme raison sociale. La
 *     `denomination` de `listepersonnes` est la bonne.
 *   - `listepersonnes` décrit l'entreprise CONCERNÉE ; sur une cession, c'est
 *     l'acquéreur, et `listeprecedentproprietaire` porte le cédant.
 *   - Le champ `administration` nomme les dirigeants, avec une grammaire
 *     régulière : « NOM Prénoms devient gérant », « NOM Prénoms n'est plus
 *     président ». 134 annonces sur 300 en portent un.
 */

/** Force d'un signal, du plus décisif au plus anecdotique. */
export type SignalStrength = "fort" | "moyen" | "faible";

export const STRENGTH_LABELS: Record<SignalStrength, string> = {
  fort: "signal fort",
  moyen: "signal moyen",
  faible: "signal faible",
};

/** Ordre d'affichage : le plus fort d'abord. */
export const STRENGTH_RANK: Record<SignalStrength, number> = { fort: 3, moyen: 2, faible: 1 };

export interface RawRecord {
  registre?: string[] | string | null;
  listepersonnes?: string | null;
  listeprecedentproprietaire?: string | null;
  listeprecedentexploitant?: string | null;
  commercant?: string | null;
  ville?: string | null;
  cp?: string | null;
  familleavis_lib?: string | null;
  dateparution?: string | null;
  modificationsgenerales?: string | null;
  acte?: string | null;
  url_complete?: string | null;
}

interface Personne {
  typePersonne?: string;
  denomination?: string;
  nom?: string;
  prenom?: string;
  administration?: string;
  capital?: { montantCapital?: string; devise?: string };
  numeroImmatriculation?: { numeroIdentification?: string };
}

/** `personne` est tantôt un objet, tantôt un tableau. */
function firstPerson(raw: string | null | undefined): Personne | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { personne?: Personne | Personne[] };
    const person = Array.isArray(parsed.personne) ? parsed.personne[0] : parsed.personne;
    return person ?? null;
  } catch {
    // Champ non-JSON : fréquent, ce n'est pas une anomalie.
    return null;
  }
}

/** Neuf chiffres, quelle que soit l'écriture (« 911 864 023 »). */
function nineDigits(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

/**
 * SIREN de l'entreprise concernée.
 *
 * `listepersonnes` d'abord : sur une cession, `registre` peut porter l'un ou
 * l'autre des deux SIREN cités, alors que `listepersonnes` désigne sans
 * ambiguïté l'entreprise dont l'annonce parle.
 */
export function sirenOf(record: RawRecord): string | null {
  const person = firstPerson(record.listepersonnes);
  const fromPerson = nineDigits(person?.numeroImmatriculation?.numeroIdentification);
  if (fromPerson) return fromPerson;

  const values = Array.isArray(record.registre)
    ? record.registre
    : record.registre
      ? [record.registre]
      : [];
  for (const value of values) {
    const siren = nineDigits(value);
    if (siren) return siren;
  }
  return null;
}

/** Raison sociale, sans la concaténation de `commercant`. */
export function companyNameOf(record: RawRecord): string | null {
  const person = firstPerson(record.listepersonnes);
  const denomination = person?.denomination?.trim();
  if (denomination) return denomination;
  // Personne physique : nom + prénom plutôt que la chaîne brute.
  const composed = [person?.nom, person?.prenom].filter(Boolean).join(" ").trim();
  if (composed) return composed;
  return record.commercant?.trim() || null;
}

/**
 * Personne physique (entrepreneur individuel) ou personne morale ?
 *
 * Mesuré : 24 % de `pp`. Un entrepreneur individuel n'atteint pas la tranche
 * « 10 à 49 salariés » visée et coûterait un appel Pappers. Le doute profite à
 * la cible : un champ illisible est gardé.
 */
export function isLegalEntity(record: RawRecord): boolean {
  const person = firstPerson(record.listepersonnes);
  if (!person) return true;
  return person.typePersonne !== "pp";
}

/** Capital déclaré APRÈS l'opération, en euros. Le précédent n'est jamais donné. */
export function capitalOf(record: RawRecord): number | null {
  const raw = firstPerson(record.listepersonnes)?.capital;
  if (!raw || (raw.devise && raw.devise !== "EUR")) return null;
  const amount = Number(raw.montantCapital);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Texte décrivant l'opération, quelle que soit la colonne qui le porte. */
export function descriptifOf(record: RawRecord): string | null {
  for (const raw of [record.modificationsgenerales, record.acte]) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["descriptif", "nature", "categorie", "typeAnnonce"]) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      // Non-JSON : la famille reste l'information utile.
    }
  }
  return null;
}

/** Un dirigeant entrant, tel que l'annonce le nomme. */
export interface BodaccLeader {
  /** Nom de famille, en capitales dans la source. */
  surname: string;
  /** Prénom d'usage : le premier de la liste. */
  firstName: string;
  /** Rôle pris (« gérant », « président »…). */
  role: string;
}

/** Un mot est-il écrit tout en capitales ? Les accents ne doivent pas tromper. */
function isUpper(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters === letters.toLocaleUpperCase("fr-FR");
}

/**
 * Dirigeants qui PRENNENT une fonction.
 *
 * La grammaire de la source est régulière : « NOM Prénoms [nom d'usage : NOM]
 * devient gérant », séparé par des points. On ne garde que les « devient » —
 * un départ (« n'est plus président ») n'est pas un nouveau dirigeant, et
 * c'est précisément ce qui distingue un vrai changement de tête d'une simple
 * radiation de mandat.
 *
 * Le nom se lit sur la casse : les mots tout en capitales forment le nom de
 * famille (« LE PERFF »), les suivants les prénoms. La source contient des
 * coquilles (« non d'usage » pour « nom d'usage ») : on les absorbe.
 */
export function newLeadersOf(record: RawRecord): BodaccLeader[] {
  const text = firstPerson(record.listepersonnes)?.administration;
  if (!text) return [];

  const leaders: BodaccLeader[] = [];
  for (const rawSegment of text.split(/\.(?:\s|$)/)) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    const becomes = /\bdevient\s+(.+)$/i.exec(segment);
    if (!becomes) continue;

    const role = becomes[1].trim().replace(/[.;,]+$/, "");
    // Tout ce qui précède « devient », débarrassé de la mention de nom d'usage
    // (et de sa coquille « non d'usage », présente dans la source).
    const identity = segment
      .slice(0, becomes.index)
      .replace(/\b[nm]o[nm]\s+d'usage\s*:.*$/i, "")
      .trim();

    const words = identity.split(/\s+/).filter(Boolean);
    const surname: string[] = [];
    const given: string[] = [];
    for (const word of words) {
      if (given.length === 0 && isUpper(word)) surname.push(word);
      else given.push(word);
    }
    if (!surname.length || !given.length) continue;

    leaders.push({ surname: surname.join(" "), firstName: given[0], role });
  }
  return leaders;
}

/**
 * L'entreprise concernée est-elle le CÉDANT d'une cession ?
 *
 * Sur « Ventes et cessions », `listepersonnes` porte l'acquéreur et
 * `listeprecedentproprietaire` le cédant. Si le SIREN retenu est celui du
 * cédant, l'annonce dit que l'entreprise se sépare de son fonds : ce n'est pas
 * une cible, c'est une sortie.
 */
export function isSeller(record: RawRecord): boolean {
  const siren = sirenOf(record);
  if (!siren) return false;
  for (const raw of [record.listeprecedentproprietaire, record.listeprecedentexploitant]) {
    const previous = nineDigits(firstPerson(raw)?.numeroImmatriculation?.numeroIdentification);
    if (previous && previous === siren) return true;
  }
  return false;
}

/**
 * L'annonce décrit-elle une fin ?
 *
 * Mesuré : 17 % des « Modifications diverses » sont des dissolutions ou des
 * cessations. Écarter la famille entière coûterait les 83 % utiles ; ne rien
 * filtrer faisait remonter « Dissolution sans liquidation » comme signal
 * d'achat. On filtre donc la nature, pas la famille.
 *
 * Une fusion où l'entreprise ABSORBE (« Modification du capital. Sociétés
 * ayant participé à l'opération de fusion ») ne contient aucun de ces mots et
 * reste retenue.
 */
export function isNegativeNature(nature: string | null): boolean {
  if (!nature) return false;
  return /dissolution|liquidation|radiation|cessation d'activit|cl[oô]ture|sauvegarde|redressement judiciaire/i.test(
    nature,
  );
}

/** Familles d'annonces lues. Voir `BODACC_FAMILIES` pour la justification. */
export type BodaccFamily =
  | "Modifications diverses"
  | "Ventes et cessions"
  | "Créations"
  | "Immatriculations";

export interface Classification {
  strength: SignalStrength;
  /** Type de signal du référentiel de scoring. */
  signalType: string;
  /** Formulation courte et lisible de l'événement. */
  label: string;
}

/**
 * Force et nature d'une annonce.
 *
 * Le barème vient du besoin commercial, pas de la structure BODACC :
 *
 *   FORT   un nouveau dirigeant prend ses fonctions, le capital bouge, ou
 *          l'entreprise ACQUIERT un fonds. Dans les trois cas quelqu'un vient
 *          de prendre une décision engageante.
 *   MOYEN  un établissement s'ouvre, le siège est transféré, l'entreprise
 *          vient d'être immatriculée : un fait, mais pas une décision d'achat.
 *   FAIBLE dénomination, objet social, forme juridique. Vrai, daté, et sans
 *          portée commerciale — jamais un angle principal.
 *
 * `null` = annonce écartée.
 *
 * Nuance que la seule lecture du descriptif ne donne pas : « Modification de
 * l'administration » couvre aussi bien une nomination qu'un simple départ.
 * C'est le champ `administration` qui tranche, et c'est pour ça que le
 * classement le lit plutôt que de se fier au descriptif.
 */
export function classify(
  family: BodaccFamily,
  descriptif: string | null,
  leaders: readonly BodaccLeader[],
  seller: boolean,
): Classification | null {
  if (isNegativeNature(descriptif)) return null;
  // Se séparer de son fonds n'est pas un projet : c'est une sortie.
  if (seller) return null;

  const text = (descriptif ?? "").toLocaleLowerCase("fr-FR");

  if (leaders.length) {
    const leader = leaders[0];
    return {
      strength: "fort",
      signalType: "direction",
      label: `${leader.firstName} ${leader.surname} devient ${leader.role}`,
    };
  }

  if (family === "Ventes et cessions") {
    return { strength: "fort", signalType: "croissance", label: "Reprise d'un fonds de commerce" };
  }

  if (/capital/.test(text)) {
    // BODACC ne dit jamais « augmentation » ni « réduction », et ne donne pas
    // le capital précédent : le SENS de la modification n'est pas connu ici.
    // Il est confirmé plus tard, en comparant au capital de la fiche Pappers.
    return { strength: "fort", signalType: "croissance", label: "Modification du capital" };
  }

  if (/nouvel établissement|établissement principal|nouveau siège|transfert/.test(text)) {
    return { strength: "moyen", signalType: "croissance", label: "Nouvel établissement ou siège" };
  }

  if (family === "Créations" || family === "Immatriculations") {
    return { strength: "moyen", signalType: "creation", label: "Immatriculation récente" };
  }

  if (/dénomination|nom commercial|pseudonyme|nom d'usage/.test(text)) {
    return { strength: "faible", signalType: "presse", label: "Changement de dénomination" };
  }
  if (/forme juridique/.test(text)) {
    return { strength: "faible", signalType: "presse", label: "Changement de forme juridique" };
  }
  if (/activité|objet/.test(text)) {
    return { strength: "faible", signalType: "presse", label: "Changement d'objet social" };
  }

  // Modification au registre sans nature reconnue : vraie, datée, sans portée.
  return { strength: "faible", signalType: "presse", label: "Modification au registre" };
}
