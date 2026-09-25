import type { Prospect } from "@/types";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import { isOpaqueNaf, nafLabel } from "@/lib/naf";
import { companyAge, frenchDate, isFresh } from "@/lib/enrichment/dates";
import { resolvePlaybook } from "@/lib/sector-playbook";
import {
  attachSignals,
  displayCompanyName,
  type RejectedSignal,
} from "@/lib/enrichment/entity-match";
import { interpretJob } from "./job-roles";
import { looksLikeSubsidiaryByFigures } from "@/lib/enrichment/headcount";

/**
 * Faits du prospect, calculés côté serveur.
 *
 * Deux responsabilités, au-delà du calcul :
 *
 * 1. PRIORISER. Tous les faits ne valent pas une accroche. Une offre d'emploi
 *    d'automaticien parue il y a trois semaines ouvre un mail ; un chiffre
 *    d'affaires, non — c'est vrai, public, et ça n'apprend rien au lecteur.
 *    Chaque fait porte donc un `hookTier` de 1 (meilleur) à 5.
 *
 * 2. DIRE CE QUI EST UTILISABLE DANS LE CORPS. Un ratio sert à raisonner, pas
 *    à écrire : « 1 167 951 € par personne » dans un mail est grotesque. Ces
 *    faits portent `bodyUsable: false` et seule leur forme arrondie passe.
 */

export type FactSource =
  | "Annuaire Entreprises"
  | "Pappers"
  | "Site officiel"
  | "Hunter"
  | "Signal web"
  | "calculé";

/** 1 = ouvre un mail, 5 = ne l'ouvre jamais seul. */
export type HookTier = 1 | 2 | 3 | 4 | 5;

/**
 * CLE CANONIQUE d'un fait.
 *
 * Deux sources disaient la meme chose de deux facons — « 57 ans » d'un cote,
 * « 58 ans » de l'autre ; le CA du registre et le CA repete par un article.
 * Chaque fait porte donc une cle : a cle egale, une seule valeur survit, celle
 * de la source la mieux classee (`SOURCE_RANK`). Le registre gagne toujours
 * sur le web, par construction.
 */
export type FactKey =
  | "signal"
  | "group_signal"
  | "parent_group"
  | "naf"
  | "family"
  | "city"
  | "website"
  | "site_offer"
  | "size_range"
  | "headcount"
  | "revenue"
  | "net_income"
  | "revenue_per_head"
  | "age"
  | "leader"
  | "contact";

/**
 * Autorite des sources. Le registre (Annuaire, Pappers) fait foi sur tout fait
 * de registre : un article de presse qui contredit le SIREN a tort.
 */
const SOURCE_RANK: Record<FactSource, number> = {
  "Annuaire Entreprises": 4,
  Pappers: 4,
  "Site officiel": 3,
  Hunter: 3,
  "calculé": 2,
  "Signal web": 1,
};

/** Cles pouvant porter plusieurs faits : chaque signal est un evenement distinct. */
const MULTI_VALUE: Set<FactKey> = new Set(["signal", "group_signal"]);

export interface DerivedFact {
  id: string;
  /** Cle canonique : deux faits de meme cle ne coexistent pas. */
  key: FactKey;
  label: string;
  /**
   * Valeur BRUTE, exacte. C'est elle qu'on affiche.
   *
   * Elle ne contient JAMAIS de consigne de redaction : « 500000 salariés (à
   * écrire « une 500000aine de personnes ») » est parti en production parce
   * que la consigne destinee au modele etait concatenee ici.
   */
  value: string;
  /**
   * Consigne destinee au REDACTEUR uniquement : comment dire ce fait dans un
   * mail. Jamais affichee dans l'interface.
   */
  writerHint?: string;
  source: FactSource;
  url?: string;
  hookTier: HookTier;
  /**
   * `false` quand la valeur ne doit jamais apparaître telle quelle dans le
   * corps : ratios, montants au centime.
   */
  bodyUsable: boolean;
  /** Date ISO d'un signal, `null` s'il n'est pas daté. Absente hors signaux. */
  date?: string | null;
  /** Signal daté de moins de 60 jours : seul admis comme angle principal. */
  fresh?: boolean;
  /** Pour une offre d'emploi : ce que fait le poste, et ce que ça implique. */
  reading?: string;
}

const ANNUAIRE = "https://annuaire-entreprises.data.gouv.fr/entreprise/";

/** Postes dont l'ouverture signale un besoin d'automatisation. */
const AUTOMATION_ROLES =
  /automaticien|automatisation|data\b|données|informatique|it\b|erp\b|adv\b|administration des ventes|planificateur|ordonnancement|supply|logistique|back[- ]office|assistant[e]? administratif|gestionnaire/i;

const RECRUITMENT = /recrute|recrutement|offre d'emploi|poste|cdi\b|nous recherchons|rejoign/i;

/**
 * Categories de poste directement automatisables, telles que l'extraction
 * structuree les nomme. Meme liste que le scoring, meme sens.
 */
const AUTOMATION_CATEGORIES = new Set(["automation", "data", "it", "ops"]);

export function headcountMidpoint(sizeRange: string | null | undefined): number | null {
  if (!sizeRange) return null;
  const numbers = sizeRange.replace(/ /g, "").match(/\d[\d\s]*/g);
  if (!numbers?.length) return null;
  const bounds = numbers.map((value) => Number(value.replace(/\s/g, ""))).filter(Number.isFinite);
  if (!bounds.length) return null;
  if (bounds.length === 1) return bounds[0];
  return Math.round((bounds[0] + bounds[1]) / 2);
}

/**
 * Lecture du CA par salarié, PAR FAMILLE MÉTIER.
 *
 * L'interprétation figée précédente sortait « revente d'énergie » pour une
 * agence d'intérim, dont le CA est simplement gonflé par la masse salariale
 * qu'elle refacture. Hors des familles connues, on ne conclut rien.
 */
export function revenuePerHeadReading(perHead: number, familyKey: string): string {
  if (perHead < 200_000) return "CA/salarié modéré : activité à forte intensité de main-d'œuvre interne";

  switch (familyKey) {
    case "interim_rh":
      return "CA gonflé par la masse salariale des intérimaires refacturée : beaucoup de contrats de mission et de relevés d'heures pour peu de permanents";
    case "commerce":
      return "CA élevé par salarié, typique du négoce : le volume de commandes traité dépasse largement la taille de l'équipe";
    case "cvc_maintenance":
      return "CA élevé par salarié : revente d'énergie ou de fluides, où la marge se joue sur le suivi des installations plus que sur la main-d'œuvre";
    case "transport_logistique":
      return "CA élevé par salarié : volume de flux transportés sans rapport avec l'effectif administratif";
    default:
      // Sans famille identifiee, on constate sans interpreter.
      return "CA élevé rapporté à l'effectif : beaucoup de volume traité par peu de personnes";
  }
}

const euros = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);

/** Montant arrondi, tel qu'on peut l'écrire dans un mail. */
export function roundedEuros(value: number): string {
  if (value >= 1_000_000) return `~${Math.round(value / 1_000_000)} M€`;
  if (value >= 1_000) return `~${Math.round(value / 1_000)} k€`;
  return `~${Math.round(value)} €`;
}

/** Effectif arrondi, tel qu'on peut l'écrire dans un mail. */
export function roundedHeadcount(value: number): string {
  if (value < 15) return "une petite équipe";
  const decade = Math.round(value / 10) * 10;
  return `une ${decade === 50 ? "cinquantaine" : `${decade}aine`} de personnes`.replace("100aine", "centaine");
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Nettoie un extrait de signal : markdown, emojis, puces, et coupe à la phrase.
 *
 * Les extraits arrivaient bruts de Linkup — « - [Voir l'offre](https://…) 🔥 » —
 * et le modèle recopiait la syntaxe dans le mail.
 */
export function cleanExcerpt(raw: string, maxLength = 220): string {
  const text = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_`>|]/g, " ")
    .replace(/^\s*[-•·]\s*/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" ! "), cut.lastIndexOf(" ? "));
  return (lastStop > 60 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/** `true` si le signal ne fait que répéter une donnée du registre. */
export function duplicatesRegistry(text: string): boolean {
  const haystack = text.toLowerCase();
  return (
    /cr[ée]{2}e? le \d|immatricul|siren|rcs |capital social|forme juridique|code naf|ape\b/.test(haystack) &&
    !/recrute|offre d'emploi|ouvre|inaugur|lev[ée]e de fonds|rachat|acquisition/.test(haystack)
  );
}

export interface FactsResult {
  facts: DerivedFact[];
  headcount: number | null;
  /** Famille métier retenue, éventuellement déduite hors NAF. */
  familyKey: string;
  familyLabel: string;
  /** Société mère détectée, s'il y en a une. */
  parent: string | null;
  /** Dirigeant personne physique, pour la salutation. */
  leaderPerson: string | null;
  /** Holding par laquelle on est passe pour l'identifier. */
  leaderVia: string | null;
  /** Filiale d'un grand groupe : l'ecran et le score doivent le savoir. */
  isLargeGroupSubsidiary: boolean;
  /** Indices d'appartenance a un groupe, sources melangees. */
  groupEvidence: string[];
  /** Nom a ecrire dans un mail : denomination du registre ou enseigne confirmee. */
  companyName: string;
  /** Signaux web ecartes par l'anti-homonymie, avec leur raison. */
  rejectedSignals: RejectedSignal[];
  /** Entites voisines ecartees : leur nom ne doit jamais sortir dans un mail. */
  foreignEntities: string[];
  /**
   * Confiance dans le modele economique, 0 a 1. Plafonnee a 0,4 quand le site
   * officiel n'a pas ete lu : sans site, on ne connait pas leur metier reel.
   */
  businessModelConfidence: number;
}

export function buildFacts(
  prospect: Prospect,
  contact?: DecisionMakerContact | null,
  now = new Date(),
  siteText?: string | null,
): FactsResult {
  const figures = prospect.key_figures ?? {};
  const facts: DerivedFact[] = [];
  let counter = 0;

  const add = (
    key: FactKey,
    label: string,
    value: string | null,
    source: FactSource,
    hookTier: HookTier,
    options: {
      url?: string;
      bodyUsable?: boolean;
      date?: string | null;
      fresh?: boolean;
      reading?: string;
      /** Comment ECRIRE ce fait ; jamais affiche. */
      writerHint?: string;
    } = {},
  ) => {
    if (!value) return;

    // Deduplication par cle canonique : la source la mieux classee l'emporte,
    // et a egalite la premiere arrivee reste.
    if (!MULTI_VALUE.has(key)) {
      const existing = facts.findIndex((fact) => fact.key === key);
      if (existing >= 0) {
        if (SOURCE_RANK[source] <= SOURCE_RANK[facts[existing].source]) return;
        facts.splice(existing, 1);
      }
    }

    counter += 1;
    facts.push({
      id: `f${counter}`,
      key,
      label,
      value,
      source,
      hookTier,
      bodyUsable: options.bodyUsable !== false,
      ...(options.writerHint ? { writerHint: options.writerHint } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.date !== undefined ? { date: options.date, fresh: Boolean(options.fresh) } : {}),
      ...(options.reading ? { reading: options.reading } : {}),
    });
  };

  const siren = str(prospect.siren);
  const annuaireUrl = siren ? `${ANNUAIRE}${siren}` : undefined;
  const nafCode = str(figures.naf_code);

  // Le metier se deduit du NAF, sauf pour un siege ou une holding : dans ce cas
  // c'est le nom, le site et les signaux qui parlent.
  const signalText = (prospect.signals ?? [])
    .map((signal) => `${str(signal.label) ?? ""} ${str(signal.quote) ?? ""}`)
    .join(" ");
  const freeText = `${prospect.company_name} ${siteText ?? ""} ${signalText}`;
  const playbook = resolvePlaybook(nafCode, prospect.sector, freeText);

  // --- Anti-homonymie --------------------------------------------------------
  // Rejoue a la generation la regle de rattachement de l'enrichissement : les
  // prospects enrichis avant elle portent encore des signaux d'homonymes.
  const parent = str(figures.parent_company);
  const attachment = attachSignals(
    prospect.signals ?? [],
    {
      name: prospect.company_name,
      siren,
      website: str(figures.site_status) === "non trouvé" ? null : str(prospect.website),
    },
    {
      parentCompany: parent,
      parentGroup: str(figures.parent_group),
      parentGroupQuote: str(figures.parent_group_quote),
    },
  );
  const storedForeign = Array.isArray(figures.foreign_entities)
    ? (figures.foreign_entities as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const foreignEntities = [...new Set([...storedForeign, ...attachment.foreignEntities])];

  // --- Tier 1 : recrutement lie a l'automatisation, recent ------------------
  for (const signal of attachment.kept) {
    const quote = str(signal.quote);
    const url = str(signal.url);
    if (!quote || !url) continue;

    const text = `${str(signal.label) ?? ""} ${quote}`;
    if (duplicatesRegistry(text)) continue;

    const date = str(signal.date);
    const fresh = isFresh(date, now);

    // Signal d'une entite du groupe : contexte, jamais une nouvelle du prospect.
    if (signal.scope === "groupe") {
      add(
        "group_signal",
        `Actualité du groupe ${str(signal.entity) ?? ""}`.trim(),
        `${cleanExcerpt(quote)} (${frenchDate(date)})`,
        "Signal web",
        4,
        { url, date, fresh: false },
      );
      continue;
    }

    // La categorie vient de l'extraction structuree quand elle a tourne ;
    // sinon on retombe sur la lecture du texte.
    const category = typeof signal.category === "string" ? signal.category : null;
    const isAutomationHire =
      (category !== null && AUTOMATION_CATEGORIES.has(category)) ||
      (RECRUITMENT.test(text) && AUTOMATION_ROLES.test(text));

    // Un signal non date ou perime ne peut pas ouvrir un mail : rang 3 au mieux.
    const tier: HookTier = isAutomationHire && fresh ? 1 : fresh ? 3 : 4;
    const job = RECRUITMENT.test(text) || signal.type === "recrutement" ? interpretJob(text) : null;
    add(
      "signal",
      isAutomationHire ? "Recrutement lié aux process" : "Signal web",
      `${cleanExcerpt(quote)} (${frenchDate(date)})`,
      "Signal web",
      tier,
      {
        url,
        date,
        fresh,
        ...(job ? { reading: `${job.label} : ${job.does}. Ouverture ⇒ ${job.consequence}` } : {}),
      },
    );
  }

  // --- Tier 2 : appartenance a un groupe -----------------------------------
  // Deux indices INDEPENDANTS, affiches tels quels : le registre (representant
  // personne morale) et le web (extraction structuree). Ils se confirment
  // souvent ; quand ils divergent, le lecteur doit le voir.
  const parentGroup = str(figures.parent_group);
  const groupEvidence = Array.isArray(figures.group_evidence)
    ? (figures.group_evidence as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  // Le drapeau vient normalement de l'enrichissement. On le rededuit ici des
  // chiffres pour qu'il vaille AUSSI sur une fiche deja en base ou un jeu de
  // test : 1,296 Md€ de CA pour 75 salaries, c'est une filiale, toujours.
  const isSubsidiary =
    figures.is_large_group_subsidiary === true ||
    looksLikeSubsidiaryByFigures(num(figures.revenue_eur), num(figures.headcount));

  add(
    "parent_group",
    "Société mère",
    parentGroup ?? parent
      ? [
          parentGroup ? `Groupe ${parentGroup} (source web)` : null,
          parent ? `Représentée par ${parent} (registre)` : null,
          isSubsidiary ? "— décision probablement au niveau groupe" : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null,
    parentGroup ? "Signal web" : "Annuaire Entreprises",
    2,
    { url: str(figures.parent_group_url) ?? annuaireUrl },
  );

  // --- Tier 4 : metier et identite -----------------------------------------
  const naf = nafLabel(nafCode, prospect.sector);
  add(
    "naf",
    "Activité (NAF)",
    naf ? `${nafCode} — ${naf.label}${naf.precision !== "sous-classe" ? ` (libellé de ${naf.precision})` : ""}` : prospect.sector,
    "Annuaire Entreprises",
    4,
    { url: annuaireUrl },
  );
  if (isOpaqueNaf(nafCode)) {
    add(
      "family",
      "Métier réel",
      `${playbook.family} — déduit du nom et du site, le code NAF étant celui d'un siège ou d'une holding`,
      "calculé",
      4,
    );
  } else if (playbook.processes.length) {
    add("family", "Famille métier", playbook.family, "calculé", 4);
  }
  add("city", "Ville", str(prospect.city), "Annuaire Entreprises", 5, { url: annuaireUrl });
  // Un site absent est une INFORMATION : on l'ecrit, on ne paraphrase jamais
  // le NAF pour combler le trou.
  const siteStatus = str(figures.site_status);
  add(
    "website",
    "Site officiel",
    str(prospect.website) ?? (siteStatus === "non trouvé" ? "non trouvé" : null),
    "Site officiel",
    5,
    { url: str(prospect.website) ?? undefined },
  );
  add("site_offer", "Ce que dit leur site", str(figures.site_offer), "Site officiel", 3);

  // --- Tier 5 : taille et finances -----------------------------------------
  const sizeRange = str(prospect.size_range) ?? str(figures.size_range);
  add("size_range", "Tranche d'effectif", sizeRange, "Annuaire Entreprises", 5, { url: annuaireUrl });

  const exact = num(figures.headcount);
  if (exact !== null) {
    add("headcount", "Effectif", `${exact} salariés`, "Pappers", 5, {
      writerHint: `à écrire « ${roundedHeadcount(exact)} »`,
    });
  }
  const headcount = exact ?? headcountMidpoint(sizeRange);

  const revenue = num(figures.revenue_eur);
  const revenueYear = num(figures.revenue_year);
  add(
    "revenue",
    "Chiffre d'affaires",
    revenue !== null
      ? `${euros(revenue)}${revenueYear ? ` (exercice ${revenueYear})` : ""}`
      : null,
    "Pappers",
    5,
    { bodyUsable: false },
  );
  add(
    "net_income",
    "Résultat net",
    num(figures.net_income_eur) !== null ? euros(figures.net_income_eur as number) : null,
    "Pappers",
    5,
    { bodyUsable: false },
  );

  if (revenue !== null && headcount) {
    const perHead = Math.round(revenue / headcount);
    add(
      "revenue_per_head",
      "CA par salarié",
      `${euros(perHead)} par personne — ${revenuePerHeadReading(perHead, playbook.key)}`,
      "calculé",
      5,
      // Un ratio sert a RAISONNER. Il n'a rien a faire dans le corps du mail.
      { bodyUsable: false },
    );
  }

  // Age : un seul calcul, centralise dans lib/enrichment/dates.
  const age = companyAge(
    { foundedOn: str(figures.founded_on), foundedYear: num(figures.founded_year) },
    now,
  );
  if (age) {
    add(
      "age",
      "Ancienneté",
      `${age.years} ans (créée en ${str(figures.founded_on)?.slice(0, 4) ?? num(figures.founded_year)})`,
      "Annuaire Entreprises",
      5,
      { url: annuaireUrl },
    );
  }

  const leaderPerson = str(figures.leader_person);
  const leaderVia = str(figures.leader_via);
  add(
    "leader",
    "Dirigeant",
    leaderPerson ? `${leaderPerson}${leaderVia ? ` (via ${leaderVia})` : ""}` : null,
    leaderVia ? "Pappers" : "Annuaire Entreprises",
    5,
    { url: annuaireUrl },
  );

  if (contact?.email) {
    const parts = [contact.full_name, contact.position].filter(Boolean).join(", ");
    add(
      "contact",
      "Contact identifié",
      `${parts || contact.email}${contact.confidence != null ? ` — confiance ${contact.confidence} %` : ""}`,
      "Hunter",
      5,
    );
  }

  // L'ordre de lecture EST la priorite : le modele lit de haut en bas.
  facts.sort((a, b) => a.hookTier - b.hookTier);
  facts.forEach((fact, index) => {
    fact.id = `f${index + 1}`;
  });

  return {
    facts,
    headcount,
    familyKey: playbook.key,
    familyLabel: playbook.family,
    parent,
    leaderPerson,
    leaderVia,
    isLargeGroupSubsidiary: isSubsidiary,
    groupEvidence,
    companyName: displayCompanyName(prospect.company_name, [
      str(figures.site_offer) ?? "",
      ...attachment.kept
        .filter((signal) => signal.scope !== "groupe")
        .map((signal) => str(signal.quote) ?? ""),
    ]),
    rejectedSignals: attachment.rejected,
    foreignEntities,
    businessModelConfidence:
      siteStatus === "lu" ? (str(figures.site_offer) ? 0.8 : 0.6) : siteStatus === "trouvé" ? 0.5 : 0.4,
  };
}

/** Bloc numéroté injecté dans le prompt d'analyse, trié par potentiel d'accroche. */
export function factsBlock(facts: DerivedFact[]): string {
  if (!facts.length) return "FAITS : aucun. Dis-le plutot que d'inventer.";

  const tierName: Record<HookTier, string> = {
    1: "ACCROCHE PRIORITAIRE",
    2: "groupe",
    3: "signal recent",
    4: "metier",
    5: "contexte — n'ouvre jamais un mail seul",
  };

  return `FAITS NUMEROTES, tries par potentiel d'accroche. Tu ne peux affirmer que
ce qui s'appuie sur ces ids. Les faits de rang 5 ne peuvent porter l'accroche
que si AUCUN fait de rang 1 a 4 n'existe.
${facts
  .map(
    (fact) =>
      `[${fact.id}] (rang ${fact.hookTier} — ${tierName[fact.hookTier]}) ${fact.label} : ${fact.value}` +
      `${fact.bodyUsable ? "" : "  << NE PAS ECRIRE CETTE VALEUR TELLE QUELLE DANS LE MAIL >>"}` +
      `${fact.date !== undefined ? (fact.fresh ? "  [date < 60 j]" : "  [NON DATE OU > 60 J : jamais en angle principal]") : ""}` +
      `  (source : ${fact.source}${fact.url ? `, ${fact.url}` : ""})` +
      `${fact.writerHint ? `  << ${fact.writerHint} >>` : ""}` +
      `${fact.reading ? `\n      Lecture du poste : ${fact.reading}` : ""}`,
  )
  .join("\n")}`;
}

/**
 * Nombres autorisés dans le CORPS.
 *
 * Seuls les faits `bodyUsable` comptent, plus les formes arrondies des
 * montants. Un ratio ou un montant au centime n'y figure pas : c'est ce qui
 * empêche « 1 167 951 € par personne » d'atterrir dans un mail.
 */
export function knownNumbers(facts: DerivedFact[]): Set<number> {
  const known = new Set<number>();
  for (const fact of facts) {
    const matches = fact.value.replace(/ /g, " ").matchAll(/\d[\d\s]*(?:[.,]\d+)?/g);
    for (const match of matches) {
      const value = Number(match[0].replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(value)) continue;
      // Les arrondis restent permis meme pour un fait non utilisable brut :
      // « ~41 M€ » vient bien du chiffre d'affaires.
      known.add(Math.round(value / 1_000_000));
      known.add(Math.floor(value / 1_000_000));
      known.add(Math.round(value / 1_000));
      if (!fact.bodyUsable) continue;
      known.add(value);
      known.add(Math.round(value));
    }
  }
  return known;
}

/**
 * Retire d'un texte les nombres qui ne viennent pas des faits.
 *
 * Une consigne ne suffit pas : « 268 points de livraison » et « 80 000
 * interimaires » revenaient dans les accroches parce que le modele pioche le
 * chiffre le plus spectaculaire d'une plaquette. On enleve le nombre et son
 * unite immediate, pas la phrase : « vos 80 000 interimaires » devient « vos
 * interimaires », ce qui reste vrai.
 */
export function stripUnknownNumbers(text: string, allowed: Set<number>): string {
  return text
    .replace(/(\d[\d\s]*(?:[.,]\d+)?)(\s*(?:%|€|EUR|M€|k€|GWh|MWh|kWh|tonnes?|t))?/gi, (match, digits: string) => {
      const value = Number(String(digits).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(value)) return match;
      return allowed.has(value) || allowed.has(Math.round(value)) ? match : "";
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s([,.;:])/g, "$1")
    .trim();
}
