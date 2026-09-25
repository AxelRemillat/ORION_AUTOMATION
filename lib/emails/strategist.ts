import { z } from "zod";
import { PERSONA, type PersonaProof } from "@/lib/persona";
import { factsBlock, knownNumbers, stripUnknownNumbers, type DerivedFact } from "./derived-facts";
import { jobRolesBlock } from "./job-roles";

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
3. SIGNAL NON DATE OU DE PLUS DE 60 JOURS : INTERDIT comme angle principal.
   Les faits marques « NON DATE OU > 60 J » ne vont jamais dans hookFactIds.
   Sans signal frais, l'angle est groupe, modèle_éco ou métier.
4. OFFRE D'EMPLOI : interprete-la par ce que le poste FAIT reellement.
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

  // Fraîcheur : aucun signal non daté ou périmé dans l'accroche.
  const stale = data.angle.hookFactIds
    .map((id) => byId.get(id))
    .filter((fact): fact is DerivedFact => Boolean(fact && fact.date !== undefined && !fact.fresh));
  if (stale.length) {
    errors.push(
      `angle.hookFactIds : ${stale.map((fact) => fact.id).join(", ")} non daté(s) ou de plus de 60 jours, interdit(s) comme angle principal`,
    );
  }
  if (data.angle.type === "recrutement" || data.angle.type === "signal") {
    const freshHook = data.angle.hookFactIds.some((id) => {
      const fact = byId.get(id);
      return Boolean(fact && fact.key === "signal" && fact.fresh);
    });
    if (!freshHook) {
      errors.push(`angle.type « ${data.angle.type} » exige un signal daté de moins de 60 jours dans hookFactIds`);
    }
  }

  if (data.proofId !== null && !proofById(data.proofId)) {
    errors.push(`proofId « ${data.proofId} » n'est pas une preuve publique (${PUBLIC_PROOFS.map((proof) => proof.id).join(", ")} ou null)`);
  }

  if (isBannedPain(data.pain.task)) {
    errors.push(`pain.task « ${data.pain.task} » est générique : nomme une tâche du métier`);
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

  return {
    brief: {
      rankedFacts: data.rankedFacts,
      angle: { ...data.angle, insight: clean(data.angle.insight) },
      pain: { ...data.pain, task: clean(data.pain.task), automationIdea: clean(data.pain.automationIdea) },
      proofId: data.proofId,
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
