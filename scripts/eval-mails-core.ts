/**
 * Cœur PUR de `npm run eval:mails` : cas de référence, juge aveugle, rapport.
 * Aucun appel réseau ici — c'est ce que les tests couvrent avec des fixtures.
 */
import { bodyWordCount, MAX_BODY_WORDS, withoutSignature } from "@/lib/mail-preflight/words";

export interface MailText {
  subject: string;
  body: string;
}

export interface EvalCase {
  id: string;
  /** Motif ILIKE sur `prospects.company_name`. */
  match: string;
  /** Mail de référence écrit à la main. Absent : on lit le mail programmé en base. */
  reference?: MailText;
  referenceFromScheduled?: boolean;
  note?: string;
  /**
   * CAS NÉGATIF : la génération doit REFUSER.
   *
   * Tout ne mérite pas un mail. GLOBAL 2F est un commerce de détail sans
   * salarié : produire un texte poli pour cette fiche est un échec, pas un
   * demi-succès. Le cas est donc gagné quand rien n'est généré.
   */
  expect?: "refus";
}

export const JUDGE_CRITERIA = ["accroche", "pain", "preuve", "longueur", "ton", "salutation"] as const;
export type JudgeCriterion = (typeof JUDGE_CRITERIA)[number];

export type Outcome = "gagne" | "egalite" | "perd";

export interface Verdict {
  outcome: Outcome;
  /** Pour chaque critère, la version meilleure (du point de vue du GÉNÉRÉ). */
  criteria: Record<JudgeCriterion, Outcome>;
  reasons: string;
}

/** Position aléatoire mais reproductible : le juge ne sait pas qui est qui. */
export function generatedIsA(caseId: string, seed = 0): boolean {
  let hash = seed;
  for (const char of caseId) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  return hash % 2 === 0;
}

/**
 * Le juge lit les CORPS, signature retiree, et le nombre de mots compte comme
 * l'UI. Premier rapport (28/09/2026) : la signature etait comptee, les mails
 * de ~100 mots s'affichaient « 111-120 » et le juge sanctionnait la longueur.
 */
export function buildJudgePrompt(
  a: MailText,
  b: MailText,
  companyName: string,
  signature?: string | null,
): { system: string; user: string } {
  const system = `Tu evalues deux emails de prospection a froid ecrits par un freelance en
automatisation et agents IA, pour la meme PME. Tu ne sais pas lequel a ete ecrit
a la main. Compare-les sur six criteres :
- accroche : UN fait concret et propre a cette entreprise, dit simplement ;
- pain : le vrai probleme de leur metier, pas celui que suggere leur code NAF ;
- preuve : une demo ou un exemple EN RAPPORT avec ce pain (hors sujet = pire que rien) ;
- longueur : 110 mots au plus hors signature, rien de superflu ;
- ton : direct, sobre, sans formule commerciale ni paraphrase creuse ;
- salutation : « Bonjour Monsieur/Madame <nom>, » quand le dirigeant est connu.

Pour chaque critere : "A", "B" ou "egalite". Puis un verdict global.
Reponds UNIQUEMENT en JSON :
{ "criteres": { "accroche": "A", "pain": "egalite", "preuve": "B", "longueur": "A", "ton": "A", "salutation": "egalite" },
  "global": "A" | "B" | "egalite",
  "raisons": "3 phrases au plus, concretes" }`;
  const show = (label: string, mail: MailText) =>
    `=== EMAIL ${label} (${bodyWordCount(mail.body, signature)} mots hors signature) ===\n` +
    `Objet : ${mail.subject}\n\n${withoutSignature(mail.body, signature).trim()}`;
  return { system, user: `Entreprise : ${companyName}\n\n${show("A", a)}\n\n${show("B", b)}` };
}

const pick = (value: unknown): "A" | "B" | "egalite" | null => {
  const text = typeof value === "string" ? value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : "";
  if (text === "a") return "A";
  if (text === "b") return "B";
  if (text.startsWith("egal")) return "egalite";
  return null;
};

/** Traduit « A / B / égalité » en gagne / égalité / perd pour le mail GÉNÉRÉ. */
export function parseVerdict(raw: string, generatedA: boolean): Verdict | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const toOutcome = (choice: "A" | "B" | "egalite"): Outcome =>
    choice === "egalite" ? "egalite" : (choice === "A") === generatedA ? "gagne" : "perd";
  const global = pick(json.global);
  if (!global) return null;
  const given = (json.criteres ?? {}) as Record<string, unknown>;
  const criteria = Object.fromEntries(
    JUDGE_CRITERIA.map((criterion) => [criterion, toOutcome(pick(given[criterion]) ?? "egalite")]),
  ) as Record<JudgeCriterion, Outcome>;
  return { outcome: toOutcome(global), criteria, reasons: typeof json.raisons === "string" ? json.raisons : "" };
}

export interface CaseResult {
  id: string;
  company: string;
  generated: MailText | null;
  reference: MailText | null;
  verdict: Verdict | null;
  error?: string;
  /** Cas négatif : attendu et obtenu. Un refus y vaut une victoire. */
  negative?: { expected: boolean; refused: boolean };
  /** Ce que le pipeline savait : site, profil metier, contact. Sert a diagnostiquer une defaite. */
  diagnostics?: string[];
}

const LABEL: Record<Outcome, string> = { gagne: "gagne", egalite: "égalité", perd: "perd" };

/**
 * Objectif : égalité ou victoire sur 3 cas sur 4.
 *
 * Un cas NÉGATIF compte comme réussi quand la génération a refusé : ne pas
 * écrire à une fiche hors cible est un bon résultat, pas une absence de
 * résultat.
 */
export function goalReached(results: CaseResult[], needed = 3): boolean {
  return results.filter((result) =>
    result.negative ? result.negative.refused : Boolean(result.verdict && result.verdict.outcome !== "perd"),
  ).length >= needed;
}

export function renderReport(
  results: CaseResult[],
  meta: { date: string; judgeModel: string; signature?: string | null },
): string {
  const count = (mail: MailText) => bodyWordCount(mail.body, meta.signature);
  const lines = [
    `# Évaluation des mails — ${meta.date}`,
    "",
    `Juge aveugle : \`${meta.judgeModel}\`. Généré contre référence écrite à la main. Mots comptés hors signature, comme l'UI.`,
    `Objectif : égalité ou victoire sur 3 cas sur 4 → **${goalReached(results) ? "atteint" : "non atteint"}**.`,
    "",
    "| Cas | Verdict | Mots (généré / réf.) | " + JUDGE_CRITERIA.join(" | ") + " |",
    "| --- | --- | --- | " + JUDGE_CRITERIA.map(() => "---").join(" | ") + " |",
  ];
  for (const result of results) {
    const words = (mail: MailText | null) => (mail ? String(count(mail)) : "–");
    const cells = JUDGE_CRITERIA.map((criterion) => (result.verdict ? LABEL[result.verdict.criteria[criterion]] : "–"));
    if (result.negative) {
      lines.push(
        `| ${result.company} | ${result.negative.refused ? "**refusé (attendu)**" : "**MAIL PRODUIT**"} | – | ` +
          `${JUDGE_CRITERIA.map(() => "–").join(" | ")} |`,
      );
      continue;
    }
    lines.push(
      `| ${result.company} | ${result.verdict ? `**${LABEL[result.verdict.outcome]}**` : `erreur`} | ${words(result.generated)} / ${words(result.reference)} | ${cells.join(" | ")} |`,
    );
  }
  for (const result of results) {
    lines.push("", `## ${result.company}`, "");
    if (result.error) lines.push(`> ${result.error}`, "");
    if (result.diagnostics?.length) lines.push(...result.diagnostics.map((line) => `- ${line}`), "");
    if (result.verdict) lines.push(`**${LABEL[result.verdict.outcome]}** — ${result.verdict.reasons}`, "");
    for (const [title, mail] of [["Généré", result.generated], ["Référence", result.reference]] as const) {
      if (!mail) continue;
      const over = count(mail) > MAX_BODY_WORDS ? ` ⚠️ > ${MAX_BODY_WORDS} mots` : "";
      lines.push(`### ${title}${over}`, "", `**Objet : ${mail.subject}**`, "", "```", mail.body, "```", "");
    }
  }
  return lines.join("\n");
}
