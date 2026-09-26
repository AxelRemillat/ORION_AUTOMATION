import { z } from "zod";
import { PERSONA, type PersonaProof } from "@/lib/persona";
import { factsBlock, knownNumbers, stripUnknownNumbers, type DerivedFact } from "./derived-facts";
import { jobRolesBlock } from "./job-roles";
import { DATED_EVENT_KEYS } from "./hook-readiness";

/**
 * ÉTAPE 2 — le STRATÈGE : il trie, il ne rédige pas.
 *
 *   extraction → STRATÈGE → RÉDACTEUR → JUGE
 *
 * Il lit TOUS les faits structurés, le persona et ses preuves, et l'historique
 * des messages envoyés à ce prospect. Il rend un BRIEF : les faits qui
 * comptent, l'angle, le pain, la preuve, le CTA et ce qu'il ne faut pas dire.
 * Le rédacteur ne verra que ce brief et les faits qu'il référence.
 *
 * Tout ce que le code peut trancher est tranché par le code, après le modèle :
 * ids de faits existants, fraîcheur du signal d'accroche, preuve publique,
 * angle exclu, avertissement de ciblage et nom de l'entreprise.
 */

export const ANGLE_TYPES = ["recrutement", "groupe", "signal", "modèle_éco", "métier"] as const;
export type AngleType = (typeof ANGLE_TYPES)[number];

const FACT_ID = z.string().regex(/^f\d+$/);

export const BRIEF_SCHEMA = z.object({
  rankedFacts: z
    .array(z.object({ id: FACT_ID, reason: z.string().min(3).max(200) }))
    .min(1)
    .max(5),
  angle: z.object({
    type: z.enum(ANGLE_TYPES),
    hookFactIds: z.array(FACT_ID).min(1).max(3),
    insight: z.string().min(15).max(300),
  }),
  pain: z.object({
    task: z.string().min(5).max(160),
    whyThem: z.array(FACT_ID).min(1).max(4),
    automationIdea: z.string().min(10).max(300),
  }),
  proofId: z.string().nullable(),
  cta: z.string().min(5).max(200),
  avoid: z.array(z.string().min(2).max(200)).max(10),
  /** Imposé par le code, jamais par le modèle. */
  targetingWarning: z.string().nullable().optional(),
});

export type RawBrief = z.infer<typeof BRIEF_SCHEMA>;
export type BriefAngle = RawBrief["angle"];

/** Brief final : sortie du modèle, corrigée et complétée par le code. */
export type StrategyBrief = Omit<RawBrief, "targetingWarning"> & {
  targetingWarning: string | null;
  /** Nom à écrire : dénomination du registre ou enseigne confirmée. */
  companyName: string;
  /** Angles déjà proposés puis écartés, pour « Autre angle ». */
  excludedAngles: BriefAngle[];
};

export interface HistoryMessage {
  subject: string | null;
  body: string;
  sent_at: string | null;
}

export interface StrategistInput {
  facts: DerivedFact[];
  companyName: string;
  isLargeGroupSubsidiary: boolean;
  /** Groupe annoncé par le web, ou société mère du registre. */
  parentGroup: string | null;
  /** Entités homonymes écartées : leur nom est interdit dans le mail. */
  foreignEntities: string[];
  /** Messages déjà ENVOYÉS à ce prospect. */
  history: HistoryMessage[];
  /** Angles à ne pas reprendre (« Autre angle »). */
  excludeAngles?: BriefAngle[];
  /** Secteur ou activité déclarée : sert à repérer un pain qui redit l'offre. */
  sector?: string | null;
}

const PUBLIC_PROOFS = (PERSONA.proofs as readonly PersonaProof[]).filter((proof) => proof.publicOk);

/** Preuve publique d'id donné, ou `null`. */
export function proofById(id: string | null | undefined): PersonaProof | null {
  return PUBLIC_PROOFS.find((proof) => proof.id === id) ?? null;
}

/**
 * Avertissement de ciblage, calculé par le code.
 * Filiale de grand groupe : la décision d'achat se prend probablement au
 * groupe, et un mail au site local risque de rester sans suite.
 */
export function targetingWarningFor(input: {
  isLargeGroupSubsidiary: boolean;
  parentGroup: string | null;
}): string | null {
  const group = input.parentGroup ? ` (${input.parentGroup})` : "";
  if (input.isLargeGroupSubsidiary) {
    return `Filiale de grand groupe${group}, décision probablement au groupe.`;
  }
  if (input.parentGroup) {
    return `Appartient au groupe ${input.parentGroup} : vérifier qui décide avant d'envoyer.`;
  }
  return null;
}

/** Deux angles identiques : même type, même fait d'accroche principal. */
export function sameAngle(a: BriefAngle, b: BriefAngle): boolean {
  return a.type === b.type && a.hookFactIds[0] === b.hookFactIds[0];
}

/** Ids de faits référencés par le brief, dans l'ordre de priorité. */
export function briefFactIds(brief: Pick<RawBrief, "rankedFacts" | "angle" | "pain">): string[] {
  return [
    ...new Set([
      ...brief.angle.hookFactIds,
      ...brief.pain.whyThem,
      ...brief.rankedFacts.map((item) => item.id),
    ]),
  ];
}

/** Les SEULS faits que le rédacteur et le juge verront. */
export function briefFacts(
  brief: Pick<RawBrief, "rankedFacts" | "angle" | "pain">,
  facts: DerivedFact[],
): DerivedFact[] {
  const ids = new Set(briefFactIds(brief));
  return facts.filter((fact) => ids.has(fact.id));
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const historyBlock = (history: HistoryMessage[]): string =>
  history.length
    ? `MESSAGES DEJA ENVOYES A CE PROSPECT — ne repete ni leur angle ni leur pain :
${history
  .slice(-4)
  .map((message) => `- (${message.sent_at?.slice(0, 10) ?? "date ?"}) ${message.subject ?? "sans objet"} : ${message.body.replace(/\s+/g, " ").slice(0, 280)}`)
  .join("\n")}`
    : "MESSAGES DEJA ENVOYES A CE PROSPECT : aucun.";

export function buildStrategistPrompt(input: StrategistInput): { system: string; user: string } {
  const excluded = input.excludeAngles?.length
    ? `ANGLES DEJA PROPOSES ET REFUSES — choisis un angle DIFFERENT (autre type, ou autre fait d'accroche) :
${input.excludeAngles.map((angle) => `- ${angle.type} sur ${angle.hookFactIds.join(", ")} : ${angle.insight}`).join("\n")}`
    : "";

  const system = `Tu es le STRATEGE d'une prospection a froid. Tu n'ecris AUCUN mail.
Tu choisis ce qu'un redacteur dira, a partir de faits verifies, et tu le
justifies. Le redacteur ne verra QUE ton brief et les faits que tu cites.

QUI ECRIT : ${PERSONA.fullName}, freelance. Offre : ${PERSONA.offer}.
Forme de l'offre : ${PERSONA.offerShape}.

PREUVES DISPONIBLES (proofId) — les seules experiences citables :
${PUBLIC_PROOFS.map((proof) => `- ${proof.id} [${proof.tags.join(", ")}] : ${proof.text}`).join("\n")}
Choisis celle qui colle au pain, ou null si aucune ne colle. Pas de preuve de remplissage.

REGLES
1. rankedFacts : les 5 faits les plus utiles au plus, du meilleur au moins bon,
   chacun avec une raison d'une ligne.
2. angle.type parmi : recrutement | groupe | signal | modèle_éco | métier.
   hookFactIds : le(s) fait(s) qui portent l'accroche, le principal en premier.
   insight : UNE phrase, ce que le lecteur apprend ou reconnait de son quotidien.
3. SIGNAL NON DATE OU PERIME : INTERDIT comme angle principal.
   Les faits marques « NON DATE OU PERIME » ne vont jamais dans hookFactIds.
   Sans evenement date, l'angle est groupe, modèle_éco ou métier.
   Trois familles portent une accroche datee : un signal web frais, une
   OUVERTURE d'etablissement de moins d'un an, un DIRIGEANT arrive depuis moins
   d'un an. Une ouverture ou une arrivee prime sur le metier, toujours.
3 bis. DIRIGEANT ENTRANT : l'angle est sa SITUATION, pas son secteur. Ses
   premiers mois sont ceux ou l'on remet a plat les outils.
3 ter. STRUCTURE JURIDIQUE INTERDITE EN ACCROCHE : capital, forme juridique,
   representant personne morale, appartenance a un groupe comme fait d'ouverture.
   Ce sont des faits de ciblage. Ne parle d'augmentation de capital que si un
   fait le dit explicitement — un capital eleve n'est pas une augmentation.
4. OFFRE D'EMPLOI : interprete-la par ce que le poste FAIT reellement.
   Ne propose JAMAIS de remplacer le poste recrute : on allege la tache qui
   debordait AVANT l'embauche, et le pain se dit ainsi.
   Un automaticien programme des automates et supervise des installations ; ce
   n'est PAS « alleger des taches repetitives ». Lecture des postes frequents :
${jobRolesBlock()}
5. pain.task : la tache, dans le vocabulaire DU METIER (pas « gestion
   administrative », pas « gagner du temps »). whyThem : les factIds qui la
   rendent probable CHEZ EUX. automationIdea : un flux concret — ce qui
   declenche, ce qui est lu, ce qui est ecrit, dans quel outil.
6. cta : UNE question ouverte, a laquelle on repond en une ligne.
7. avoid : ce qu'il ne faut PAS dire a ce prospect (angle deja servi, sujet
   sensible, formulation qui sonnerait faux vu les faits).
8. NOM : l'entreprise s'appelle « ${input.companyName} ». Aucun autre nom
   d'entite ne la designe.${input.foreignEntities.length ? ` En particulier, ${input.foreignEntities.map((name) => `« ${name} »`).join(", ")} est une AUTRE entreprise (homonyme) : n'en parle jamais.` : ""}
9. N'invente aucun chiffre ; ne cite que des factIds existants.

Reponds UNIQUEMENT avec un objet JSON :
{
  "rankedFacts": [ { "id": "f1", "reason": "..." } ],
  "angle": { "type": "recrutement", "hookFactIds": ["f1"], "insight": "..." },
  "pain": { "task": "...", "whyThem": ["f1", "f3"], "automationIdea": "..." },
  "proofId": "p2",
  "cta": "... ?",
  "avoid": ["..."]
}`;

  const user = `Entreprise : ${input.companyName}

${factsBlock(input.facts)}

${historyBlock(input.history)}

${excluded}`.trim();

  return { system, user };
}

// ---------------------------------------------------------------------------
// Validation et finalisation
// ---------------------------------------------------------------------------

export type BriefOutcome = { brief: StrategyBrief; error?: undefined } | { brief: null; error: string };

/**
 * Pains bannis : vrais pour n'importe quelle entreprise, donc sans valeur
 * dans un mail à froid. Tous constatés en production.
 */
/**
 * Ce que l'entreprise VEND n'est pas ce qu'elle VIT.
 *
 * Le mail parti a ANDRA LEARNING disait « Andra Learning s'efforce de deployer
 * l'excellence » puis proposait d'automatiser « vos processus de formation » —
 * c'est-a-dire leur METIER, leur raison d'etre. On ne vend pas a quelqu'un en
 * lui presentant son offre comme un probleme.
 *
 * Une liste blanche d'operations a ete essayee puis abandonnee : « tri des
 * alarmes de supervision » est une operation interne parfaitement valable et
 * n'y figurait pas. On detecte donc l'inverse — la RESTITUTION de l'offre —
 * en comparant le pain au secteur et a l'activite declaree de l'entreprise.
 */
const OFFER_ECHO = [
  "votre offre",
  "votre proposition de valeur",
  "vos prestations",
  "votre cœur de metier",
  "votre coeur de metier",
  "ce que vous vendez",
  "votre savoir-faire",
  "votre mission",
];

/**
 * Verbes de plaquette : les reprendre revient a paraphraser leur slogan.
 * « s'efforce de deployer l'excellence » etait mot pour mot leur accueil.
 */
const SLOGAN = [
  "s'efforce",
  "se veut",
  "ambitionne",
  "a coeur de",
  "se positionne comme",
  "excellence",
  "expertise reconnue",
  "acteur majeur",
  "met un point d'honneur",
];

/**
 * Mots vides : ils ne portent pas le sens et fausseraient le recoupement.
 *
 * « processus », « gestion » et consorts sont inclus a dessein : ils donnent
 * l'ILLUSION d'un contenu. « processus de formation » n'ajoute rien a
 * « formation » — c'est le metier, repeint en probleme.
 */
const STOP_WORDS = new Set([
  "des", "les", "leur", "leurs", "pour", "avec", "dans", "vos", "votre", "une",
  "cette", "aux", "par", "sur", "chez", "que", "qui", "est", "sont", "plus",
  "processus", "process", "gestion", "gerer", "traitement", "traiter", "suivi",
  "activite", "activites", "service", "services", "demarche", "demarches",
  "operations", "metier", "quotidien", "interne", "internes",
]);

const significant = (text: string): Set<string> =>
  new Set(
    (normalize(text).match(/[a-z]{5,}/g) ?? []).filter((word) => !STOP_WORDS.has(word)),
  );

/**
 * Le pain restitue-t-il simplement l'activite de l'entreprise ?
 *
 * On compare son vocabulaire a celui du secteur declare : si le pain n'apporte
 * AUCUN mot que le secteur ne contienne deja, il ne dit rien de nouveau — il
 * renomme leur metier en probleme.
 */
export function restatesTheOffer(painTask: string, sectorOrActivity: string | null): boolean {
  if (OFFER_ECHO.some((term) => normalize(painTask).includes(normalize(term)))) return true;
  if (!sectorOrActivity) return false;

  const pain = significant(painTask);
  if (pain.size === 0) return false;
  const sector = significant(sectorOrActivity);
  return [...pain].every((word) => sector.has(word));
}

/** `true` si le texte reprend le vocabulaire de plaquette de l'entreprise. */
export function paraphrasesSlogan(text: string): boolean {
  const haystack = normalize(text);
  return SLOGAN.some((word) => haystack.includes(normalize(word)));
}

/**
 * La preuve recoupe-t-elle le pain ?
 *
 * Le mail ANDRA LEARNING mobilisait « j'ai relie des flux d'alertes a des
 * declenchements automatiques cote commande et planification » pour un pain de
 * formation : hors sujet, et donc pire que pas de preuve du tout.
 */
export function proofMatchesPain(proofId: string | null, painText: string): boolean {
  if (!proofId) return true; // aucune preuve : toujours permis
  const proof = proofById(proofId);
  if (!proof) return false;
  const haystack = normalize(painText);
  return proof.tags.some((tag) => haystack.includes(normalize(tag)));
}

const BANNED_PAINS = [
  "proposition commerciale",
  "propositions commerciales",
  "gestion administrative",
  "optimiser vos processus",
  "gagner du temps",
  "processus administratif",
  "back-office",
];

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function isBannedPain(text: string): boolean {
  const haystack = normalize(text);
  return BANNED_PAINS.some((term) => haystack.includes(normalize(term)));
}

/**
 * Valide un brief (sortie du modèle OU brief édité à la main) et le complète.
 * Renvoie une erreur lisible, renvoyée telle quelle au modèle lors du retry.
 */
export function validateBrief(raw: unknown, input: StrategistInput): BriefOutcome {
  const parsed = BRIEF_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return {
      brief: null,
      error: parsed.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(" | "),
    };
  }
  const data = parsed.data;
  const byId = new Map(input.facts.map((fact) => [fact.id, fact]));
  const errors: string[] = [];

  const unknown = briefFactIds(data).filter((id) => !byId.has(id));
  if (unknown.length) errors.push(`factIds inexistants : ${unknown.join(", ")}`);

  // Un exercice de plus de trois ans ne porte pas une accroche : « votre CA
  // 2017 » se voit tout de suite et date le mail autant que le chiffre.
  const staleFinance = data.angle.hookFactIds
    .map((id) => byId.get(id))
    .filter((fact): fact is DerivedFact => Boolean(fact && /, ancien\)/.test(fact.value)));
  if (staleFinance.length) {
    errors.push(
      `angle.hookFactIds : ${staleFinance.map((fact) => fact.id).join(", ")} porte(nt) un exercice de plus de ` +
        "trois ans, inutilisable comme angle",
    );
  }

  // Fraîcheur : aucun signal non daté ou périmé dans l'accroche.
  const stale = data.angle.hookFactIds
    .map((id) => byId.get(id))
    .filter((fact): fact is DerivedFact => Boolean(fact && fact.date !== undefined && !fact.fresh));
  if (stale.length) {
    errors.push(
      `angle.hookFactIds : ${stale.map((fact) => fact.id).join(", ")} non daté(s) ou périmé(s), interdit(s) comme angle principal`,
    );
  }
  if (data.angle.type === "recrutement" || data.angle.type === "signal") {
    // Trois familles datent un evenement : le signal web, l'ouverture
    // d'etablissement et l'arrivee d'un dirigeant. Les deux dernieres sont
    // aussi solides que la premiere — elles viennent du registre, pas du web.
    const freshHook = data.angle.hookFactIds.some((id) => {
      const fact = byId.get(id);
      return Boolean(fact && DATED_EVENT_KEYS.has(fact.key) && fact.fresh);
    });
    if (!freshHook) {
      errors.push(`angle.type « ${data.angle.type} » exige un événement daté et récent dans hookFactIds`);
    }
  }

  if (data.proofId !== null && !proofById(data.proofId)) {
    errors.push(`proofId « ${data.proofId} » n'est pas une preuve publique (${PUBLIC_PROOFS.map((proof) => proof.id).join(", ")} ou null)`);
  }

  if (isBannedPain(data.pain.task)) {
    errors.push(`pain.task « ${data.pain.task} » est générique : nomme une tâche du métier`);
  }

  // Le pain porte sur les OPERATIONS, jamais sur l'offre de l'entreprise.
  if (restatesTheOffer(data.pain.task, input.sector ?? null)) {
    errors.push(
      `pain.task « ${data.pain.task} » redit ce que l'entreprise VEND, pas ce qu'elle VIT. ` +
        "Nomme une opération interne qui tourne AUTOUR du métier : onboarding client, " +
        "facturation, planification des intervenants, reporting client, relances…",
    );
  }


  // Paraphrase de plaquette : ça ne dit rien et ça se voit.
  const slogan = [data.angle.insight, data.pain.task].find(paraphrasesSlogan);
  if (slogan) {
    errors.push(`« ${slogan.slice(0, 60)} » reprend le slogan du site : dis un fait, pas leur promesse`);
  }

  const excluded = input.excludeAngles ?? [];
  if (excluded.some((angle) => sameAngle(angle, data.angle))) {
    errors.push("angle identique à un angle déjà refusé : change de type ou de fait d'accroche");
  }

  if (errors.length) return { brief: null, error: errors.join(" | ") };

  const allowed = knownNumbers(input.facts);
  const clean = (text: string) => stripUnknownNumbers(text, allowed);
  const forbidden = input.foreignEntities.map(
    (name) => `Ne jamais nommer « ${name} » : entreprise distincte, homonyme probable.`,
  );

  // Une preuve hors sujet dessert plus qu'elle ne sert : on la RETIRE plutot
  // que de rejeter tout le brief. Le mail ANDRA LEARNING mobilisait « j'ai
  // relie des flux d'alertes » pour un pain de formation — mieux vaut ne rien
  // citer que de citer a cote.
  const painText = `${data.pain.task} ${data.pain.automationIdea}`;
  const proofId = proofMatchesPain(data.proofId, painText) ? data.proofId : null;

  return {
    brief: {
      rankedFacts: data.rankedFacts,
      angle: { ...data.angle, insight: clean(data.angle.insight) },
      pain: { ...data.pain, task: clean(data.pain.task), automationIdea: clean(data.pain.automationIdea) },
      proofId,
      cta: data.cta.trim(),
      avoid: [...new Set([...data.avoid, ...forbidden])],
      // Jamais laissé au modèle : dérivé des faits de groupe.
      targetingWarning: targetingWarningFor(input),
      companyName: input.companyName,
      excludedAngles: excluded,
    },
  };
}

/** Parse + validation d'une réponse brute du modèle. */
export function parseBrief(raw: string, input: StrategistInput): BriefOutcome {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { brief: null, error: "La réponse n'est pas un JSON valide." };
  }
  return validateBrief(json, input);
}

export type StrategistAsk = (system: string, user: string, operation: string) => Promise<string>;

/** Un appel, plus UNE reprise nourrie de l'erreur exacte si le brief est rejeté. */
export async function runStrategist(ask: StrategistAsk, input: StrategistInput): Promise<BriefOutcome> {
  const { system, user } = buildStrategistPrompt(input);
  const first = parseBrief(await ask(system, user, "strategie"), input);
  if (first.brief) return first;

  const retry = parseBrief(
    await ask(
      system,
      `${user}

Ta reponse precedente a ete REJETEE : ${first.error}
Corrige exactement ces points et renvoie le brief complet.`,
      "strategie:retry",
    ),
    input,
  );
  return retry.brief ? retry : { brief: null, error: retry.error ?? first.error };
}
