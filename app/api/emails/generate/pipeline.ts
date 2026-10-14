import type { AskFn } from "@/lib/ai/chat";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { ensureDemoV } from "@/lib/emails/quality/families";
import { briefFacts, type StrategyBrief } from "@/lib/emails/strategist";
import {
  validateEmail,
  type ValidationContext,
  type ValidationResult,
} from "@/lib/emails/validate";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import { AGENT_METIER_SENTENCE, chooseProof, entryOfferLabel, promiseLines, signatureFor } from "@/lib/offer/model";
import type { UserOffer } from "@/types";
import type { ToneKey } from "@/lib/tones";
import {
  buildCriticContext,
  buildCriticPrompt,
  failingCriteria,
  parseCritique,
  type Critique,
} from "./critic";
import { cleanDraft, withOptOut } from "@/lib/mail-preflight";
import { buildGreeting, buildWritingPrompt, parseEmail, planFor, type GeneratedEmail, type PlanKey } from "./prompt";

/**
 * RÉDACTEUR → validateurs → JUGE → une réécriture au plus.
 *
 * Partagé par la route et le script d'évaluation : l'A/B mesure exactement
 * ce que l'utilisateur voit à l'écran.
 */

/**
 * Phrases de preuve citables : elles viennent de /offre, plus du code. L'agent
 * devis a une variante « avec un exemple de votre métier » (chooseProof), que
 * le juge doit reconnaître comme une preuve publique et non comme une invention.
 */
const publicProofsOf = (offer: UserOffer): string[] => {
  const proofs = (offer.proofs ?? []).filter((proof) => proof.publicOk);
  const sentences = proofs.map((proof) => proof.sentence);
  return proofs.some((proof) => proof.id === "agent-devis") ? [...sentences, AGENT_METIER_SENTENCE] : sentences;
};

export interface DraftInput {
  ask: AskFn;
  brief: StrategyBrief;
  facts: DerivedFact[];
  tone: ToneKey;
  contact: DecisionMakerContact | null;
  prospectId: string;
  /** Dénomination du registre : sert au contrôle des capitales. */
  registryName: string;
  /** Ce qu'Axel vend et comment il signe (page /offre). */
  offer: UserOffer;
  /** Ouvertures et fins déjà servies. */
  avoid: string[];
  leaderPerson?: string | null;
  /** Dirigeant entrant a qui le mail s'adresse nominativement. */
  addressee?: string | null;
  /** Secteur du prospect : oriente le choix de la preuve. */
  sector?: string | null;
  forbiddenNames?: readonly string[];
  /** `false` pour « Réécrire depuis le brief » : rédacteur seul, pas de juge. */
  judge?: boolean;
  /**
   * Étape qui commence, pour la barre de progression d'un job de fond.
   * Une erreur d'écriture de l'avancement ne doit jamais casser la rédaction.
   */
  onStage?: (stage: "judge" | "rewrite") => Promise<void> | void;
}

export interface DraftOutcome {
  email: GeneratedEmail;
  validation: ValidationResult;
  critique: Critique | null;
  failing: string[];
  plan: PlanKey;
  rewritten: boolean;
}

/**
 * Retire une signature que le modele aurait ecrite malgre la consigne.
 *
 * Il glisse souvent un « Axel » seul sur la derniere ligne — c'est ce qu'il a
 * vu mille fois. On l'enleve avant d'ajouter la vraie, sinon le mail se
 * termine par deux signatures.
 */
/**
 * Chiffres que l'offre autorise dans le corps.
 *
 * « 2 a 3 semaines » et « 15 min » viennent de /offre : ce sont NOS chiffres.
 * Le validateur les refusait comme « absents des faits », ce qui faisait
 * echouer tout mail qui annonçait un delai.
 */
/** Ce qu'Axel s'engage a faire : le juge n'a pas a l'exiger des faits. */
export function commitmentsOf(offer: UserOffer): string[] {
  const entry = entryOfferLabel(offer);
  return [...promiseLines(offer), entry ? `propose ${entry}` : null].filter(
    (line): line is string => Boolean(line),
  );
}

export function offerNumbers(offer: UserOffer): number[] {
  const found = new Set<number>();
  for (const text of [offer.lead_time, offer.entry_duration, offer.entry_pitch]) {
    for (const match of (text ?? "").matchAll(/\d+/g)) {
      const value = Number(match[0]);
      if (Number.isFinite(value)) found.add(value);
    }
  }
  // « quinze minutes » s'ecrit aussi en lettres : on ne peut pas tout couvrir,
  // mais les formes chiffrees de l'offre suffisent au cas courant.
  return [...found];
}

export function stripSignature(body: string): string {
  const lines = body.trimEnd().split(/\r?\n/);
  while (lines.length) {
    const last = (lines[lines.length - 1] ?? "").trim();
    const isSignature =
      last === "" ||
      /^(bien |tres )?cordialement[.,]?$/i.test(last) ||
      /^bonne (journee|journée|soiree|soirée)[.,]?$/i.test(last) ||
      (last.split(/\s+/).length <= 4 && /^[A-ZÀ-Ý][\p{L}'-]*( [A-ZÀ-Ý][\p{L}'-]*)*[.,]?$/u.test(last));
    if (!isSignature) break;
    lines.pop();
  }
  return lines.join("\n").trimEnd();
}

/**
 * LA PHRASE D'OPPOSITION EST POSÉE PAR LE CODE, APRÈS la rédaction, le juge et
 * le validateur — comme la signature. Le modèle ne l'écrit pas et ne la voit
 * pas : elle ne peut ni être reformulée ni peser sur la note. Sans elle, le
 * contrôle avant envoi bloquait chaque mail généré.
 */
export async function draftFromBrief(input: DraftInput): Promise<DraftOutcome | { error: string }> {
  const outcome = await writeDraft(input);
  if ("error" in outcome) return outcome;
  // Cowork #58 : un lien de démo écrit par ce chemin porte toujours `v=` (famille inconnue ici : v=0).
  const body = ensureDemoV(withOptOut(outcome.email.body, signatureFor(input.offer)));
  return { ...outcome, email: { ...outcome.email, body } };
}

async function writeDraft(input: DraftInput): Promise<DraftOutcome | { error: string }> {
  const { ask, brief, tone } = input;
  const writingInput = {
    tone,
    brief,
    facts: input.facts,
    contact: input.contact,
    prospectId: input.prospectId,
    avoid: input.avoid,
    leaderPerson: input.leaderPerson,
    addressee: input.addressee,
    sector: input.sector,
    offer: input.offer,
  };
  const plan = planFor(writingInput);
  // La signature est POSEE PAR LE CODE : le modele ne l'ecrit pas, et elle ne
  // compte pas dans les mots. Avant, le mail se terminait par « Axel » seul.
  const signature = signatureFor(input.offer);
  // Le validateur et le juge ne connaissent, eux aussi, que les faits du brief.
  const allowedFacts = briefFacts(brief, input.facts);
  const context = {
    facts: allowedFacts,
    // Le « a ne pas dire » du brief devient une regle verifiee, plus une
    // simple consigne transmise au redacteur.
    avoid: brief.avoid,
    contact: input.contact,
    tone,
    companyName: input.registryName,
    signature,
    offerNumbers: offerNumbers(input.offer),
    proofs: publicProofsOf(input.offer),
    plan,
    forbiddenNames: input.forbiddenNames,
    // La salutation est fixee par le code : le validateur la fait respecter.
    greeting: buildGreeting(tone, input.contact, input.leaderPerson, input.addressee),
  };

  // Objet normalisé, ligne « Objet : » sortie du corps, une seule salutation
  // (lib/mail-preflight) : le 28/09, ces trois défauts sont partis tels quels.
  const sign = (email: GeneratedEmail | null): GeneratedEmail | null => {
    if (!email) return null;
    const clean = cleanDraft({ subject: email.subject, body: stripSignature(email.body) });
    return { ...email, subject: clean.subject, body: `${clean.body}\n\n${signature}` };
  };

  const write = (critique?: string) =>
    ask(
      "writer",
      buildWritingPrompt({ ...writingInput, critique }),
      `${critique ? "Réécris" : "Écris"} le mail pour ${brief.companyName}.`,
      critique ? 0.75 : 0.85,
      `redaction:${tone}${critique ? ":rewrite" : ""}`,
    ).then(parseEmail).then(sign);

  const judge = (email: GeneratedEmail, operation: string) =>
    ask("judge", buildCriticPrompt(
        allowedFacts,
        publicProofsOf(input.offer),
        commitmentsOf(input.offer),
        input.offer.title,
      ), buildCriticContext(brief, email), 0, operation).then(
      parseCritique,
    );

  const email = await write();
  if (!email) return { error: "Brouillon inexploitable." };
  const validation = validateEmail(email, context);

  if (input.judge === false) {
    return { email, validation, critique: null, failing: [], plan, rewritten: false };
  }

  await Promise.resolve(input.onStage?.("judge")).catch(() => undefined);
  const critique = await judge(email, "critique");
  const failing = critique ? failingCriteria(critique) : [];
  const first: DraftOutcome = { email, validation, critique, failing, plan, rewritten: false };
  if (validation.ok && failing.length === 0) return first;

  // UNE seule réécriture : au-delà, on rend la main plutôt que de boucler.
  // La longueur est mise EN TETE : c'est le point le plus souvent rate, et
  // celui qui empeche l'envoi.
  const feedback = [
    ...validation.failures.map((line) => `- ${line}`),
    ...failing.map((line) => `- ${line}`),
    ...(validation.failures.some((line) => /mots/.test(line))
      ? [
          "",
          "Pour raccourcir : garde les quatre blocs et le fond, coupe les mots qui ne",
          "portent rien — adverbes, redites, seconde clause du bloc 3. Ne supprime ni",
          "l'accroche, ni la preuve, ni la demande.",
        ]
      : []),
  ].join("\n");
  await Promise.resolve(input.onStage?.("rewrite")).catch(() => undefined);
  const rewritten = await write(feedback);
  if (!rewritten) return first;

  const secondValidation = validateEmail(rewritten, context);
  const secondCritique = await judge(rewritten, "critique:rewrite");
  const secondFailing = secondCritique ? failingCriteria(secondCritique) : [];

  /*
   * Ce qui fait qu'une reecriture est MEILLEURE.
   *
   * Les deux familles d'echec ne se valent pas. Un echec de validateur est une
   * regle dure : un mail de 138 mots depasse le plafond de 125, il ne part pas.
   * Un critere du juge sous le seuil est un avis — utile, mais qui n'empeche
   * pas l'envoi. La somme des deux mettait « trop long » et « ton un peu
   * promotionnel » a egalite, et gardait le mail trop long. D'ou la comparaison
   * lexicographique : d'abord les validateurs, ensuite le juge.
   */
  const improved =
    secondValidation.failures.length < validation.failures.length ||
    (secondValidation.failures.length === validation.failures.length &&
      secondFailing.length < failing.length);
  const best: DraftOutcome = improved
    ? { email: rewritten, validation: secondValidation, critique: secondCritique, failing: secondFailing, plan, rewritten: true }
    : first;

  return enforceLength(best, { write, context, plan });
}

/**
 * LE PLAFOND DE MOTS EST UN REFUS, PAS UN AVERTISSEMENT.
 *
 * Un mail de 123 mots sortait avec la mention « a revoir » et partait quand
 * meme : l'ecran affiche le brouillon, et personne ne recompte. Le plafond n'a
 * de sens que s'il bloque.
 *
 * Une passe de raccourcissement DEDIEE, sans juge : elle ne demande qu'une
 * chose, couper N mots, et c'est ce que les modeles font le mieux. Elle n'est
 * retenue que si elle regle la longueur SANS casser autre chose. Si la longueur
 * resiste encore, on rend une erreur : mieux vaut pas de brouillon qu'un
 * brouillon qu'on croit envoyable.
 */
async function enforceLength(
  outcome: DraftOutcome,
  deps: {
    write: (critique?: string) => Promise<GeneratedEmail | null>;
    context: ValidationContext;
    plan: "A" | "B" | "C";
  },
): Promise<DraftOutcome | { error: string }> {
  /*
   * LE MOTIF VISE LA LONGUEUR DU MAIL, pas n'importe quel message qui parle de
   * mots. La regle de phrase dit « 1 phrase(s) de plus de 20 mots » : prise pour
   * un depassement de longueur, elle declenchait la passe de raccourcissement,
   * puis le REFUS du brouillon. HUMAN SIGHT est ainsi sorti en « Echec apres 3
   * tentatives » alors que son mail faisait 112 mots.
   */
  const tooLong = (result: ValidationResult) => result.failures.find((line) => /la cible est \d+-\d+/.test(line));
  const over = tooLong(outcome.validation);
  if (!over) return outcome;

  const shortened = await deps.write(
    [
      `- ${over}`,
      "",
      "RACCOURCIS, et ne fais que ca. Garde les quatre blocs, l'accroche, la preuve",
      "et la demande. Coupe ce qui ne porte rien : adverbes, redites, seconde clause",
      "du bloc offre, precisions que le lecteur devinera. Ne change ni le fond, ni",
      "l'ordre, ni le sujet.",
    ].join("\n"),
  );
  if (shortened) {
    const check = validateEmail(shortened, deps.context);
    // Retenue seulement si la longueur passe ET que rien d'autre n'a casse.
    if (!tooLong(check) && check.failures.length <= outcome.validation.failures.length - 1) {
      return { ...outcome, email: shortened, validation: check, rewritten: true };
    }
  }

  return {
    error:
      `${over} Deux tentatives de raccourcissement n'ont pas suffi : le brouillon n'est pas ` +
      "rendu, plutot que d'etre affiche comme envoyable. Relance la generation.",
  };
}
