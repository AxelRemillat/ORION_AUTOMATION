/**
 * UNE IDÉE PAR PHRASE, ET DES PHRASES COURTES.
 *
 * Constaté sur GLOBAL 2F le 28/09/2026 : des phrases de trente mots qui
 * enchaînent deux idées, et des formules qui ne disent rien — « avant que les
 * habitudes ne reviennent », « revoir le suivi ». Un lecteur pressé décroche à
 * la deuxième subordonnée, et une formule vague ne lui apprend rien de lui.
 *
 * Trois règles, vérifiables par du code :
 *   - vingt mots au plus par phrase ;
 *   - une seule question, et c'est la dernière ;
 *   - aucune formule creuse de la liste ci-dessous.
 *
 * Module pur : la salutation et la signature sont retirées par l'appelant.
 */

export const MAX_WORDS_PER_SENTENCE = 20;

/**
 * Formules vagues : elles occupent la place d'une action concrète.
 *
 * Chacune vient d'un mail réellement généré. Elles ont en commun de décrire un
 * mouvement sans dire QUI fait QUOI : « revoir le suivi » ne se traduit en
 * aucun geste, là où « préparer la commande fournisseur » se voit tout de suite.
 */
export const VAGUE_PHRASES = [
  "avant que les habitudes",
  "revoir le suivi",
  "revoir vos process",
  "optimiser vos process",
  "gagner du temps",
  "fluidifier",
  "structurer votre organisation",
  "monter en puissance",
  "passer au niveau supérieur",
  "faire le point sur vos outils",
  "améliorer la productivité",
  "simplifier le quotidien",
  "libérer du temps",
];

const strip = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Phrases du corps, salutation et signature déjà retirées par l'appelant. */
export function sentencesOf(body: string): string[] {
  return (body ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

export const wordsIn = (sentence: string) => sentence.split(/\s+/).filter(Boolean).length;

export interface SentenceProblem {
  rule: "longueur" | "questions" | "vague";
  message: string;
}

/**
 * Les défauts de phrase d'un corps de mail, dans l'ordre où on les corrige.
 *
 * L'appelant décide si c'est bloquant : ici on constate, on ne juge pas.
 */
export function sentenceProblems(body: string): SentenceProblem[] {
  const problems: SentenceProblem[] = [];
  const sentences = sentencesOf(body);

  const long = sentences.filter((sentence) => wordsIn(sentence) > MAX_WORDS_PER_SENTENCE);
  if (long.length) {
    const worst = long.reduce((a, b) => (wordsIn(b) > wordsIn(a) ? b : a));
    problems.push({
      rule: "longueur",
      message:
        `${long.length} phrase(s) de plus de ${MAX_WORDS_PER_SENTENCE} mots. La plus longue en fait ` +
        `${wordsIn(worst)} : « ${worst.slice(0, 80)}… ». Une idée par phrase.`,
    });
  }

  const questions = sentences.filter((sentence) => sentence.includes("?"));
  if (questions.length > 1) {
    problems.push({
      rule: "questions",
      message: `${questions.length} questions : n'en garde qu'une, à la fin.`,
    });
  } else if (questions.length === 1 && sentences.length && !sentences[sentences.length - 1].includes("?")) {
    problems.push({ rule: "questions", message: "La question n'est pas la dernière phrase du mail." });
  }

  const text = strip(body ?? "");
  const found = VAGUE_PHRASES.filter((phrase) => text.includes(strip(phrase)));
  if (found.length) {
    problems.push({
      rule: "vague",
      message: `Formule vague : « ${found.join(" », « ")} ». Nomme l'action concrète à la place.`,
    });
  }
  return problems;
}
