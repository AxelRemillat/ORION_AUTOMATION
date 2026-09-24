import { z } from "zod";
import type { Prospect } from "@/types";
import type { PageContent } from "@/lib/enrichment/linkup";
import { playbookBlock, resolvePlaybook } from "@/lib/sector-playbook";
import { factsBlock, type DerivedFact } from "@/lib/emails/derived-facts";

/**
 * ÉTAPE 1 — raisonner avant d'écrire.
 *
 * La version précédente rendait un `pain_point` en texte libre : rien ne
 * l'obligeait à croiser deux faits, donc le modèle attrapait le fait le plus
 * saillant (une date de création, un chiffre d'affaires) et en faisait une
 * paraphrase — « longue expérience depuis 1969 ». Le schéma ci-dessous rend la
 * déduction structurellement obligatoire : une implication sans deux `factIds`
 * est rejetée par zod, pas par une consigne qu'on espère suivie.
 */

export const ANALYSIS_SCHEMA = z.object({
  businessModel: z.object({
    text: z.string().min(15),
    factIds: z.array(z.string()).min(1),
  }),
  /** Déductions « donc… ». Au moins deux faits croisés, sinon ce n'est pas une déduction. */
  implications: z
    .array(
      z.object({
        text: z.string().min(15),
        factIds: z.array(z.string()).min(2),
        confidence: z.number().min(0).max(1),
        isDeduction: z.boolean(),
      }),
    )
    .min(2)
    .max(3),
  painCandidates: z
    .array(
      z.object({
        task: z.string().min(5),
        whoSuffers: z.string().min(3),
        whyHere: z.string().min(10),
        factIds: z.array(z.string()).min(1),
        automationIdea: z.string().min(10),
        specificity: z.number().min(0).max(5),
      }),
    )
    .min(3)
    .max(3),
  hookCandidates: z
    .array(
      z.object({
        type: z.enum(["observation", "question", "signal"]),
        text: z.string().min(15),
        factIds: z.array(z.string()).min(1),
      }),
    )
    .min(2)
    .max(3),
  chosen: z.object({
    hookIndex: z.number().int().min(0),
    painIndex: z.number().int().min(0),
    rationale: z.string().min(10),
  }),
});

export type DeepAnalysis = z.infer<typeof ANALYSIS_SCHEMA>;
export type PainCandidate = DeepAnalysis["painCandidates"][number];
export type HookCandidate = DeepAnalysis["hookCandidates"][number];

/**
 * Pains bannis sauf preuve directe. Tous constatés en production : vrais pour
 * n'importe quelle entreprise, donc sans valeur dans un mail à froid.
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

/** `true` quand l'analyse n'a produit que des généralités. */
export function isGenericAnalysis(analysis: DeepAnalysis): boolean {
  const pain = analysis.painCandidates[analysis.chosen.painIndex] ?? analysis.painCandidates[0];
  return !pain || isBannedPain(`${pain.task} ${pain.whyHere}`) || pain.specificity < 2;
}

export function buildAnalysisPrompt(prospect: Prospect, facts: DerivedFact[]): string {
  const playbook = resolvePlaybook(
    typeof prospect.key_figures?.naf_code === "string" ? prospect.key_figures.naf_code : null,
    prospect.sector,
  );

  return `Tu es analyste. Ta seule tache : comprendre ce que fait REELLEMENT cette
entreprise et en DEDUIRE ou le travail repetitif se concentre. Tu n'ecris aucun
email a cette etape.

${factsBlock(facts)}

${playbookBlock(playbook)}

METHODE
1. businessModel : en une phrase, ce qu'ils vendent et COMMENT ils gagnent de
   l'argent. Cite les ids des faits utilises.
2. implications : deux ou trois deductions « donc... ». Chacune DOIT croiser au
   moins DEUX faits — par exemple NAF + CA par salarie, ou modele economique +
   activite de maintenance. Une implication qui reformule un seul fait n'est pas
   une deduction : c'est une paraphrase, et elle sera rejetee.
3. painCandidates : TROIS taches repetitives, dans le vocabulaire DU METIER.
   Interim : contrats de mission, releves d'heures, DPAE, sourcing.
   Exploitant frigorifique : alertes de supervision, interventions, pieces,
   reporting energie client. Pour chacune : qui la subit, pourquoi elle est
   volumineuse ou couteuse CHEZ EUX (avec les factIds), une idee
   d'automatisation concrete, et un score de specificite de 0 a 5.
   INTERDITS sauf preuve directe dans les faits : "propositions commerciales",
   "gestion administrative", "optimiser vos processus", "gagner du temps".
4. hookCandidates : trois accroches de TYPES DIFFERENTS.
   (a) observation : un croisement de faits et sa consequence concrete ;
   (b) question : une question metier precise, a laquelle un dirigeant du
       secteur repond en une seconde ;
   (c) signal : uniquement si un fait "Signal web" existe. Sinon ne produis
       que (a) et (b).
   INTERDIT : tout compliment ("j'ai ete impressionne", "votre engagement"),
   et toute simple reformulation d'un fait ("fondee en 1969", "longue
   experience"). Une accroche doit APPRENDRE quelque chose au lecteur ou lui
   montrer qu'on a compris son modele economique.
5. chosen : l'accroche et le pain retenus. Critere : specificite maximale ET
   verifiabilite. L'accroche doit passer le TEST DE SUBSTITUTION — si on
   remplace le nom par une autre entreprise du meme code NAF, la phrase ne doit
   plus tenir. Explique ton choix dans "rationale".

N'invente aucun chiffre. N'affirme rien qui ne s'appuie pas sur un factId.

CONTRAINTES DE FORME, verifiees automatiquement — une reponse qui les viole
est rejetee et tu devras recommencer :
- "implications" : EXACTEMENT 2 ou 3 entrees, chacune avec AU MOINS 2 factIds.
- "painCandidates" : EXACTEMENT 3 entrees.
- "hookCandidates" : 2 ou 3 entrees, et CHACUNE doit avoir au moins 1 factId.
  Aucune accroche sans factId, meme une question.

Reponds UNIQUEMENT avec un objet JSON de cette forme (respecte le NOMBRE
d'elements de chaque tableau) :
{
  "businessModel": { "text": "...", "factIds": ["f1", "f2"] },
  "implications": [
    { "text": "... donc ...", "factIds": ["f1", "f7"], "confidence": 0.7, "isDeduction": true },
    { "text": "... donc ...", "factIds": ["f3", "f5"], "confidence": 0.6, "isDeduction": true }
  ],
  "painCandidates": [
    { "task": "...", "whoSuffers": "...", "whyHere": "...", "factIds": ["f7"], "automationIdea": "...", "specificity": 4 },
    { "task": "...", "whoSuffers": "...", "whyHere": "...", "factIds": ["f3"], "automationIdea": "...", "specificity": 3 },
    { "task": "...", "whoSuffers": "...", "whyHere": "...", "factIds": ["f5"], "automationIdea": "...", "specificity": 3 }
  ],
  "hookCandidates": [
    { "type": "observation", "text": "...", "factIds": ["f5", "f7"] },
    { "type": "question", "text": "...", "factIds": ["f7"] }
  ],
  "chosen": { "hookIndex": 0, "painIndex": 0, "rationale": "..." }
}`;
}

/** Contexte de l'etape 1 : faits numerotes + contenu du site. */
export function buildAnalysisContext(prospect: Prospect, pages: PageContent[]): string {
  const header = `Entreprise : ${prospect.company_name}`;
  if (!pages.length) {
    return `${header}

SITE OFFICIEL : non lu (pas de site connu, ou lecture impossible). Appuie-toi
sur les faits numerotes ci-dessus.`;
  }

  return `${header}

CONTENU DU SITE OFFICIEL (source la plus fiable sur leur metier reel) :
${pages.map((page) => `--- ${page.url} ---\n${page.markdown}`).join("\n\n")}`;
}

export interface ParseOutcome {
  analysis: DeepAnalysis | null;
  /** Message d'erreur exploitable pour la relance, quand la validation echoue. */
  error?: string;
}

/**
 * Valide la sortie de l'etape 1 contre le schema.
 *
 * On renvoie l'erreur zod telle quelle : elle est renvoyee au modele lors de
 * la relance, et c'est de loin le feedback le plus efficace — il voit
 * exactement quel champ manque.
 */
export function parseDeepAnalysis(raw: string): ParseOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { analysis: null, error: "La reponse n'est pas un JSON valide." };
  }

  const result = ANALYSIS_SCHEMA.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" | ");
    return { analysis: null, error: issues };
  }

  const analysis = result.data;
  // Les index choisis doivent exister : un modele peut renvoyer 3 alors qu'il
  // n'a produit que deux accroches.
  const clamp = (value: number, max: number) => (value >= 0 && value < max ? value : 0);
  analysis.chosen.hookIndex = clamp(analysis.chosen.hookIndex, analysis.hookCandidates.length);
  analysis.chosen.painIndex = clamp(analysis.chosen.painIndex, analysis.painCandidates.length);

  return { analysis };
}

/**
 * Lance l'etape 1 avec UNE relance si le schema n'est pas respecte.
 *
 * `ask` est injecte pour que la route (qui journalise le cout) et le script
 * d'evaluation (qui ne le fait pas) partagent exactement la meme logique de
 * relance. L'erreur zod est renvoyee telle quelle au modele : c'est le
 * meilleur feedback possible, il voit quel champ manque.
 */
export async function runAnalysisWithRetry(
  ask: (system: string, user: string, temperature: number, operation: string) => Promise<string>,
  prospect: Prospect,
  facts: DerivedFact[],
  pages: PageContent[],
): Promise<ParseOutcome> {
  const system = buildAnalysisPrompt(prospect, facts);
  const context = buildAnalysisContext(prospect, pages);

  const first = parseDeepAnalysis(await ask(system, context, 0.2, "analyse-metier"));
  if (first.analysis) return first;

  const retry = parseDeepAnalysis(
    await ask(
      system,
      `${context}

Ta reponse precedente a ete REJETEE par la validation : ${first.error}
Recommence en respectant a la lettre le nombre d'elements et les factIds obligatoires.`,
      0.2,
      "analyse-metier:retry",
    ),
  );
  return retry.analysis ? retry : { analysis: null, error: retry.error ?? first.error };
}
