import { z } from "zod";
import type { DerivedFact } from "@/lib/emails/derived-facts";
import { factsBlock } from "@/lib/emails/derived-facts";
import type { StrategyBrief } from "@/lib/emails/strategist";
import type { GeneratedEmail } from "./prompt";

/**
 * Passe critique — un appel court, uniquement sur ce qu'un code ne peut pas
 * trancher.
 *
 * Le validateur déterministe attrape déjà les formules bannies, les nombres
 * inventés et la salutation. Restent des jugements : est-ce que l'accroche
 * APPREND quelque chose, est-ce que ça sonne humain, est-ce que la phrase
 * tiendrait encore si on changeait le nom de l'entreprise. C'est le seul rôle
 * du juge — et il note, il ne réécrit pas.
 */

const CRITERION = z.object({
  score: z.number().min(0).max(5),
  note: z.string().min(3),
});

export const CRITIQUE_SCHEMA = z.object({
  specificite: CRITERION,
  valeurAccroche: CRITERION,
  pertinenceMetier: CRITERION,
  verifiabilite: CRITERION,
  voix: CRITERION,
  naturel: CRITERION,
  experienceVerifiee: CRITERION,
  respectBrief: CRITERION,
});

export type Critique = z.infer<typeof CRITIQUE_SCHEMA>;

export const CRITERIA_LABELS: Record<keyof Critique, string> = {
  specificite: "Spécificité (test de substitution)",
  valeurAccroche: "Valeur de l'accroche",
  pertinenceMetier: "Pertinence métier du pain",
  verifiabilite: "Vérifiabilité",
  voix: "Voix du persona",
  naturel: "Naturel",
  experienceVerifiee: "Expérience réellement vécue",
  respectBrief: "Respect du brief",
};

/** Seuil en dessous duquel une réécriture est déclenchée. */
export const PASSING_SCORE = 3;

/** Critères sous le seuil, formatés pour être renvoyés au rédacteur. */
export function failingCriteria(critique: Critique): string[] {
  return (Object.keys(CRITERIA_LABELS) as (keyof Critique)[])
    .filter((key) => critique[key].score < PASSING_SCORE)
    .map((key) => `${CRITERIA_LABELS[key]} (${critique[key].score}/5) : ${critique[key].note}`);
}

export function buildCriticPrompt(
  facts: DerivedFact[],
  proofs: readonly string[] = [],
  /**
   * Ce qu'Axel s'engage a faire (page /offre) : delai de mise en place, « sans
   * changer d'outil », validation humaine, demande d'entree.
   *
   * Sans cette liste, le juge notait la verifiabilite a 1 ou 2 sur 5 en
   * reprochant un « delai non etaye par les faits ». C'etait une erreur de
   * grille : un engagement du vendeur n'a pas a etre prouve par un fait sur le
   * prospect.
   */
  commitments: readonly string[] = [],
  /**
   * Titre qu'Axel se donne (page /offre).
   *
   * Sans lui, le juge notait 0 sur 5 en « experience vecue » des qu'Axel
   * reformulait son propre titre — « je construis des flux d'IA en
   * production » etait lu comme la revendication d'un deploiement passe. Un
   * positionnement n'est pas une reference client.
   */
  selfTitle: string | null = null,
): string {
  return `Tu es relecteur exigeant d'emails de prospection a froid. Tu NOTES, tu ne
reecris pas. Sois severe : un 5 doit se meriter.

${factsBlock(facts)}

${selfTitle ? `TITRE QU'AXEL SE DONNE, legitime par nature : « ${selfTitle} ». Le reformuler
n'est PAS revendiquer une experience : ne le compte jamais comme telle.` : ""}

${commitments.length ? `ENGAGEMENTS D'AXEL — legitimes par nature, ils n'ont PAS a etre etayes par un fait sur le prospect :\n${commitments.map((line) => `- ${line}`).join("\n")}` : ""}

${proofs.length ? "PREUVES AUTORISEES — seules experiences qu'Axel peut revendiquer :\n" + proofs.map((proof) => "- " + proof).join("\n") : "PREUVES AUTORISEES : aucune. Toute affirmation d'experience passee vaut 0."}

Note chaque critere de 0 a 5, avec UNE phrase d'explication.

- specificite : applique le TEST DE SUBSTITUTION a la PREMIERE PHRASE apres la
  salutation. Remplace mentalement le nom de l'entreprise par celui d'un
  concurrent du meme code NAF. Si la phrase reste VRAIE, l'accroche est
  generique : 0 ou 1, et cela declenche une reecriture. Une ouverture sur le
  secteur (« Dans le commerce de gros... ») vaut 0 d'office.
  Puis, pour le reste du mail : remplace mentalement le nom
  de l'entreprise par une autre du meme secteur. Si le mail tient encore tel
  quel, c'est 0 ou 1.
- valeurAccroche : la premiere phrase apprend-elle quelque chose au lecteur, ou
  lui montre-t-elle qu'on a compris son modele economique ? Une reformulation
  d'un fait public ("fondee en 1969") vaut 1. Un compliment vaut 0.
- pertinenceMetier : le process cite appartient-il vraiment au quotidien de CE
  metier, avec son vocabulaire ? "Gestion administrative" vaut 1.
- verifiabilite : chaque affirmation SUR LE PROSPECT est-elle adossee a un fait
  ci-dessus ? Les ENGAGEMENTS d'Axel (delai de mise en place, « sans changer
  d'outil », validation humaine, duree de la demande d'entree) ne sont PAS des
  affirmations sur le prospect : ils ne demandent aucun fait. Ne les compte pas
  comme non verifiables.
- voix : premiere personne, ton humain, pas de jargon corporate, pas de
  promesse intenable.
- naturel : est-ce que ca sonne comme un humain qui ecrit a un humain, ou
  comme un texte genere ?
- experienceVerifiee : ne juge QUE les affirmations sur des CLIENTS ou des
  realisations passees. Reformuler le titre ci-dessus, ou decrire au present ce
  qu'Axel construit, vaut 5. Le mail affirme-t-il une experience passee ("j'ai mis en
  place", "pour des clients similaires", "j'accompagne") ? Si oui, elle doit
  correspondre a une des PREUVES AUTORISEES ci-dessous. Toute autre
  affirmation d'experience vaut 0 : c'est une invention, et elle se verifie en
  rendez-vous. Un mail qui decrit au present ce qu'Axel sait faire vaut 5.
- respectBrief : le mail suit-il le BRIEF ci-dessous ? L'accroche porte
  l'angle du brief, le pain est celui du brief, rien de la liste « a eviter »
  n'apparait, et l'entreprise est designee par son nom EXACT (celui du brief)
  — jamais par le nom d'une autre entite. Un autre nom d'entreprise vaut 0.

Reponds UNIQUEMENT avec un objet JSON :
{
  "specificite": { "score": 0, "note": "..." },
  "valeurAccroche": { "score": 0, "note": "..." },
  "pertinenceMetier": { "score": 0, "note": "..." },
  "verifiabilite": { "score": 0, "note": "..." },
  "voix": { "score": 0, "note": "..." },
  "naturel": { "score": 0, "note": "..." },
  "experienceVerifiee": { "score": 0, "note": "..." },
  "respectBrief": { "score": 0, "note": "..." }
}`;
}

export function buildCriticContext(brief: StrategyBrief, email: GeneratedEmail): string {
  return `BRIEF QUI A SERVI
Nom exact de l'entreprise : ${brief.companyName}
Angle (${brief.angle.type}) : ${brief.angle.insight}
Pain : ${brief.pain.task}
Flux propose : ${brief.pain.automationIdea}
A eviter : ${brief.avoid.length ? brief.avoid.join(" ; ") : "rien de particulier"}

MAIL A NOTER
Objet : ${email.subject}

${email.body}`;
}

/** Valide la sortie du juge ; `null` si elle est inexploitable. */
export function parseCritique(raw: string): Critique | null {
  try {
    const result = CRITIQUE_SCHEMA.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Note moyenne, pour l'affichage et le rapport d'evaluation. */
export function averageScore(critique: Critique): number {
  const keys = Object.keys(CRITERIA_LABELS) as (keyof Critique)[];
  return keys.reduce((total, key) => total + critique[key].score, 0) / keys.length;
}
