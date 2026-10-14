import { DAF_FAMILY, DAF_FOCUS, ENTRE_OPENING, ENTRE_WINDOW, isDafPain } from "./daf";
import type { AskFn } from "@/lib/ai/chat";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { briefFacts, type StrategyBrief } from "@/lib/emails/strategist";
import { withOptOut } from "@/lib/mail-preflight/opt-out";
import { numbersIn } from "@/lib/emails/validate";
import { DEMO_LINKS, demoFor, demoForProposal, demoForSupplierSide } from "./demo-links";
import { checklistFeedback, checklistReason, judgeChecklist, type ChecklistVerdict } from "./checklist";
import { checkMail, type RuleResult } from "./rules";
import { countWords, ctaFor, type MailParts } from "./template";
import { ALL_FAMILIES, allowedFamilies, assembleFamily, demoTextOf, familyWithSuspension, FAMILY_LIMITS, suspendedFamilies, subjectArmFor, type MailFamily } from "./families";
import { buildWriterPrompt, parseParts } from "./writer";
import { avecAllowed, mailReadiness } from "./readiness";
import type { SubjectArm } from "./experiment";
import type { KeyFact } from "./facts-gate";

/**
 * GÉNÉRATION QUALITÉ — objectif « envoyable sans retouche ».
 *
 *   rédaction → (trop long : raccourcissement dédié) → garde-fou déterministe
 *   → CHECK-LIST (Cowork #32 : critères OUI/NON avec citation, plus de note
 *   globale) → réécriture CIBLÉE sur les seuls critères à NON (3 essais au plus)
 *   → un critère toujours à NON : brouillon gardé, « À revoir » avec la raison.
 *
 * Le meilleur essai est retenu : d'abord celui qui passe le garde-fou, puis le
 * plus de critères à OUI. Rien n'est jamais envoyé ici.
 */

export const MAX_REWRITES = 2;

/**
 * Raccourcir un mail trop long est une tâche MÉCANIQUE (retirer des mots, garder le sens) : le modèle du juge
 * (gpt-6-luna) suffit, 20 fois moins cher que celui du rédacteur (Cowork #54 : 6 % du coût OpenAI). Le résultat
 * repasse les règles et le juge comme avant : un raccourci raté ne fait pas un mail prêt.
 */
export const SHORTEN_ROLE = "judge" as const;

export interface QualityInput {
  ask: AskFn;
  brief: StrategyBrief;
  facts: DerivedFact[];
  prospectId: string;
  companyName: string;
  activity: string | null;
  /** Texte écrit par le prospect lui-même (site, profil, signal) : ses sigles sont permis. */
  prospectText: string;
  greeting: string;
  signature: string;
  forbiddenNames?: readonly string[];
  offerNumbers?: readonly number[];
  /** Clichés de fin des autres mails du jour : on varie. */
  usedCliches?: readonly string[];
  /** Brouillons déjà écrits aujourd'hui, et combien ouvrent sur « Avec ». */
  dayOpenings?: { total: number; avec: number; byFamily?: Partial<Record<string, { total: number; avec: number }>> };
  /** Expérience n° 1 : bras du style d'objet (défaut : celui du prospect). */
  subjectArm?: SubjectArm;
  /** Site connu : sans lui, « profil insuffisant » dit qu'il n'y a rien à lire. */
  website?: string | null;
  /** Expérience n° 2 : famille imposée (défaut : hachage parmi les familles permises). */
  family?: MailFamily;
  /** Secteur, pour F2 et F4 quand le profil est mince. */
  sector?: string | null;
  /** Poste de la personne réellement contactée : l'angle s'y adapte. */
  recipientRole?: string | null;
  /** Accroches des derniers brouillons prêts, du plus récent au plus ancien (anti-tic « Entre … et … », Cowork #44). */
  recentHooks?: readonly string[];
  /** `key_figures.facts` triés (lib/emails/quality/facts-gate.ts) ; absent = fiche d'avant. */
  keyFacts?: readonly KeyFact[] | null;
  /**
   * EXPÉRIENCE DE MAILS (Cowork #30, lib/experiments) : phrase d'appel à l'action imposée par la
   * variante tirée. Absente (aucune expérience active) : `ctaFor` et F3_CTA, comportement d'avant.
   * Seule la DERNIÈRE PHRASE change : prompts, règles et juge sont les mêmes pour toutes les variantes.
   */
  cta?: string;
}

export interface QualityAttempt {
  parts: MailParts;
  /** Corps complet : mention « stop » et signature comprises. */
  body: string;
  rules: RuleResult;
  verdict: ChecklistVerdict | null;
  /** Démo retenue pour cet essai. */
  demo?: string;
}

export interface QualityOutcome {
  subject: string;
  body: string;
  /** 10 − pénalités des critères à NON (check-list) ; `null` = relecture indisponible. */
  score: number | null;
  /** Verdict critère par critère du brouillon retenu. */
  checklist?: ChecklistVerdict | null;
  /** `true` → « À revoir » : pas dans « Nouveaux prospects ». */
  needsReview: boolean;
  /** Pourquoi il est à revoir, en une ligne ; `null` sinon. */
  reviewReason: string | null;
  attempts: number;
  demo: string;
  /** Expérience n° 1 (en pause) : style d'objet, qui suit désormais la famille. */
  subjectStyle: SubjectArm;
  /** Expérience n° 2 : famille du mail. */
  family: MailFamily;
  history: QualityAttempt[];
}

const rank = (attempt: QualityAttempt) => (attempt.rules.ok ? 100 : 0) - attempt.rules.failures.length + (attempt.verdict?.score ?? 0);

/** Clé d'un échec de critère : même critère ET même citation (casse, espaces et ponctuation finale ignorés). */
export const failureKey = (id: string, citation: string) => `${id}|${citation.toLowerCase().replace(/\s+/g, " ").replace(/[.…!?]+$/, "").trim()}`;

/** Raccourcissements dédiés par essai, HORS des essais (Cowork #32 : F2 au-delà de 80 mots). */
export const SHORTEN_PASSES = 2;

export function buildShortenMailPrompt(family: MailFamily, words: number, max: number): string {
  return `Tu raccourcis un mail de prospection d'Axel Remillat. Il fait ${words} mots une fois assemblé ; la limite de cette famille (${family}) est ${max}. Retire environ ${words - max + 5} mots dans l'accroche et la proposition.
GARDE : le fait sur l'entreprise, le problème qui en découle, la proposition à la 1re personne et à la voix active, l'objet. COUPE : adjectifs, répétitions, détails secondaires. N'ajoute rien, ne change pas le sens.
Réponds UNIQUEMENT en JSON, mêmes clés : {"subject":"…","hook":"…","proposal":"…"}`;
}

/** Pas de mail : la fiche part en « À revoir » avec cette raison, sans appel payant. */
export type QualityBlocked = { blocked: string };

export async function generateQualityDraft(input: QualityInput): Promise<QualityOutcome | QualityBlocked | { error: string }> {
  const ready = mailReadiness({ facts: input.facts, brief: input.brief, hasSite: Boolean(input.website), companyName: input.companyName });
  /*
   * ROUTAGE selon la donnée (05/10/2026) : sans fait vérifié solide (« pain
   * incertain », profil mince), plus de blocage sec — F2 ou F4, qui
   * n'exigent que l'activité et le secteur. Sans même l'activité : bloqué.
   */
  if (!ready.ok && !input.activity?.trim()) return { blocked: ready.reason };
  const own = ready.ok ? ready.own : [];
  const allowed = allowedFamilies(ready.ok);
  /*
   * Famille IMPOSÉE (agent3) : une famille de segment — F5 « partenaire » —
   * ne participe pas au tirage de l'expérience, donc elle n'est pas dans
   * `allowed`. Sans cette ligne, l'appelant la passait et elle était
   * silencieusement remplacée par F1.
   */
  const imposed = input.family && !ALL_FAMILIES.includes(input.family) ? input.family : null;
  // Cowork #45 : douleur DAF / RAF → la question courte (F3) d'abord, quand elle est permise.
  const dafPain = isDafPain(input.brief.pain, input.recipientRole);
  const dafFamily = dafPain && allowed.includes(DAF_FAMILY) && !suspendedFamilies().has(DAF_FAMILY) ? DAF_FAMILY : null;
  const family =
    imposed ?? (input.family && allowed.includes(input.family) ? input.family : dafFamily ?? familyWithSuspension(input.prospectId, allowed));
  const demo = demoFor(`${input.brief.pain.task} ${input.brief.pain.automationIdea}`);
  // Expérience n° 1 en pause : l'objet suit la famille.
  const arm = input.subjectArm ?? subjectArmFor(family);
  const cta = input.cta ?? ctaFor(input.prospectId);
  const facts = briefFacts(input.brief, input.facts);
  // Le juge voit les MÊMES faits que le rédacteur : faits du brief + faits
  // propres (site, profil). Sinon il tient pour « supposé » ce qui est lu sur
  // le site (AGCEI, itération 2 : « bobines et transformateurs » notés 6/10).
  const factText = [
    ...[...new Set([...facts, ...own])].map((fact) => `- ${fact.label} : ${fact.value}`),
    ...(input.keyFacts ?? []).map((fact) => `- Fait vérifié (${fact.distinctiveness}/3) : ${fact.text}`),
  ].join("\n");
  // Faits soumis au critère C1 : key_figures.facts quand la fiche en a (Cowork #31), sinon ce que l'on sait d'elle.
  // Le juge voit EXACTEMENT ce que voit le rédacteur (mesure #32 : C1 refusait « épandeurs pour granulés »,
  // lu dans le profil, faute de le trouver dans les 5 extraits) : faits vérifiés + ce que l'on sait d'elle.
  // (`factText` porte déjà les faits vérifiés de key_figures.facts.)
  const checklistFacts = [
    factText,
    input.activity ? `- Activité (leur site) : ${input.activity}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  // Cowork #44 : douleur DAF / RAF → sujet imposé et démo factures ; « Entre … et … » limité.
  const daf = dafPain;
  const avoidEntre = (input.recentHooks ?? []).slice(0, ENTRE_WINDOW).some((hook) => ENTRE_OPENING.test(hook));
  const history: QualityAttempt[] = [];
  let feedback: string | null = null;
  let lastFailures = new Set<string>();
  let stalled: string | null = null;

  for (let attempt = 0; attempt <= MAX_REWRITES; attempt += 1) {
    const raw = await input.ask(
      "writer",
      buildWriterPrompt({ brief: input.brief, facts, own, activity: input.activity, sector: input.sector, companyName: input.companyName, demo, greeting: input.greeting, cta, usedCliches: input.usedCliches, avoidAvec: !avecAllowed(input.dayOpenings) || !avecAllowed(input.dayOpenings?.byFamily?.[family]), subjectArm: arm, feedback, family, recipientRole: input.recipientRole, keyFacts: input.keyFacts, focus: daf ? DAF_FOCUS : undefined, avoidEntre }),
      `${feedback ? "Réécris" : "Écris"} l'accroche, la proposition et l'objet pour ${input.companyName}.`,
      feedback ? 0.6 : 0.8,
      `qualite:redaction${feedback ? ":rewrite" : ""}`,
    ).catch(() => "");
    let parts = parseParts(raw, family);
    if (!parts) {
      feedback = "La réponse n'était pas le JSON demandé : {\"subject\",\"hook\",\"proposal\"}.";
      continue;
    }
    // La démo suit ce que le mail DIT (AGCEI, itération 2 : mail sur les devis,
    // démo e-mails choisie d'après un pain « stocks »). Repli : le pain du brief.
    // La démo illustre la phrase « J'automatise… » d'abord, puis l'objet et
    // l'accroche, puis le pain du brief (finition Cowork : SPI ENERGIE).
    const fromProposal = demoForProposal(demoTextOf(family, parts));
    const fromText = demoFor(`${parts.subject} ${parts.hook}`);
    // Jamais la page générique (ANTARES, 06/10) : à défaut, la démo des e-mails reçus.
    const picked = fromProposal.key !== "general" ? fromProposal : fromText.key !== "general" ? fromText : demo.key !== "general" ? demo : DEMO_LINKS.emails;
    // Cowork #40 : devis / commandes FOURNISSEURS → jamais la démo devis client (/agent).
    const chosen = daf ? DEMO_LINKS.factures : demoForSupplierSide(`${parts.hook} ${parts.proposal}`, picked);
    let core = assembleFamily(family, parts, { greeting: input.greeting, demo: chosen, cta, fixedCta: input.cta });
    // Trop long : raccourcissement dédié AVANT le jugement, hors des essais.
    const { max } = FAMILY_LIMITS[family];
    for (let pass = 0; pass < SHORTEN_PASSES && countWords(core) > max; pass += 1) {
      const shorter = parseParts(
        await input
          .ask(SHORTEN_ROLE, buildShortenMailPrompt(family, countWords(core), max), JSON.stringify({ subject: parts.subject, hook: parts.hook, proposal: parts.proposal }), 0.3, "qualite:raccourci")
          .catch(() => ""),
        family,
      );
      if (!shorter) continue;
      const next = assembleFamily(family, shorter, { greeting: input.greeting, demo: chosen, cta, fixedCta: input.cta });
      if (countWords(next) < countWords(core)) {
        parts = shorter;
        core = next;
      }
    }
    const rules = checkMail(parts, core, {
      greeting: input.greeting,
      facts,
      prospectText: input.prospectText,
      companyName: input.companyName,
      forbiddenNames: input.forbiddenNames,
      // Les nombres de la phrase d'appel imposée (« 2 min ») sont permis comme ceux de l'offre.
      offerNumbers: input.cta ? [...(input.offerNumbers ?? []), ...numbersIn(input.cta)] : input.offerNumbers,
      usedCliches: input.usedCliches,
      demo: chosen.key,
      subjectArm: arm,
      dayOpenings: input.dayOpenings,
      daf,
      avoidEntre,
      family,
      knownText: [input.activity, input.sector, input.brief.pain.task, input.brief.pain.automationIdea, factText].filter(Boolean).join(" "),
    });
    // La check-list n'est demandée que pour un mail qui passe le garde-fou :
    // inutile de payer pour ce que la règle a déjà tranché.
    const verdict = rules.ok
      ? await judgeChecklist(input.ask, { subject: parts.subject, core, family, greeting: input.greeting, company: input.companyName, facts: checklistFacts, recipientRole: input.recipientRole, siteText: input.prospectText, daf }, `qualite:checklist:${attempt}`)
      : null;
    const body = withOptOut(`${core}\n\n${input.signature}`, input.signature);
    history.push({ parts, body, rules, verdict, demo: chosen.path });
    if (rules.ok && verdict?.ready) break;

    // L2 (Cowork #39) : le même critère refusé deux fois avec la MÊME citation = la réécriture ne progresse pas.
    // On saute l'essai suivant (≈ 0,01 € de rédaction + juge) ; la fiche passe en « À revoir » avec le motif.
    if (rules.ok && verdict) {
      const keys = new Map(verdict.items.filter((item) => !item.ok).map((item) => [failureKey(item.id, item.citation), item] as const));
      const repeated = [...keys.keys()].find((key) => lastFailures.has(key));
      if (repeated) {
        const item = keys.get(repeated)!;
        stalled = `Réécriture sans progrès : ${item.id} ${item.label} refusé deux fois sur « ${item.citation} »`;
        break;
      }
      lastFailures = new Set(keys.keys());
    } else {
      lastFailures = new Set();
    }

    // Réécriture CIBLÉE : seulement les critères à NON, avec leur citation.
    feedback = rules.ok
      ? verdict
        ? `Critères à corriger (tous les autres sont bons, ne les change pas) :\n${checklistFeedback(verdict)}`
        : "Relecture indisponible : reprends le mail tel quel, sans changer le fond."
      : rules.failures.map((line) => `- ${line}`).join("\n");
  }

  if (!history.length) return { error: "Brouillon inexploitable : le rédacteur n'a rendu aucun texte utilisable." };
  const best = [...history].sort((a, b) => rank(b) - rank(a))[0];
  const score = best.verdict?.score ?? null;
  const passed = best.rules.ok && Boolean(best.verdict?.ready);
  const reviewReason = passed
    ? null
    : !best.rules.ok
      ? best.rules.failures[0]
      : !best.verdict
        ? "Relecture automatique indisponible : à relire avant envoi."
        : stalled ?? checklistReason(best.verdict);
  return {
    subject: best.parts.subject,
    body: best.body,
    score,
    checklist: best.verdict,
    needsReview: !passed,
    reviewReason,
    attempts: history.length,
    demo: best.demo ?? demo.path,
    subjectStyle: arm,
    family,
    history,
  };
}
