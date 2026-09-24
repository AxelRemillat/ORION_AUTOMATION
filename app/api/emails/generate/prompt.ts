import type { Prospect } from "@/types";
import { personaBlock } from "@/lib/persona";
import { toneInstruction, type ToneKey } from "@/lib/tones";
import type { DeepAnalysis } from "./analysis";

/**
 * Prompt d'analyse commerciale.
 *
 * Principe directeur : l'email ne doit contenir AUCUN chiffre que l'on ne
 * possede pas reellement sur le prospect. Une version precedente demandait au
 * modele d'estimer un volume, de le convertir en heures puis en euros ; ces
 * ordres de grandeur inventes arrivaient dans le corps du mail sous forme de
 * faits ("1 500 commandes/an", "10 500 EUR perdus"). C'est faux, et c'est le
 * genre de detail qu'un dirigeant repere immediatement.
 *
 * Le modele recoit donc les donnees reellement collectees (Pappers, annuaire
 * public, signaux web, Hunter), la liste explicite de ce qui MANQUE, et
 * l'interdiction de combler les trous. Le pain point devient une hypothese
 * assumee, ancree sur un fait verifiable.
 */

/**
 * Quatre exemples de la VOIX, volontairement dissemblables.
 *
 * Un exemple unique se faisait recopier : les mails sortaient identiques a
 * 99 %. Quatre ouvertures differentes — observation, question, signal,
 * reference metier — montrent un registre plutot qu'un moule. La consigne le
 * dit explicitement : aucune phrase ne doit etre reprise.
 */
const VOICE_EXAMPLES = [
  // Ouverture par une observation sur l'entreprise.
  `Bonjour, je suis Axel Remillat, ingenieur freelance en IA specialise en automatisation. En regardant votre site, j'ai vu que vous gerez vos demandes d'intervention par telephone et par mail. Il me semble que la prise de rendez-vous et la planification des tournees pourraient tourner toutes seules, ce qui vous rendrait pas mal de temps chaque semaine. J'ai deja construit ce genre de systeme dans des structures qui fonctionnaient pareil. Si le sujet vous parle, je vous propose 30 minutes pour en discuter.`,

  // Ouverture par une question.
  `Bonjour, combien d'heures par semaine passez-vous a ressaisir les releves d'heures de vos interimaires ? Je suis Axel Remillat, ingenieur freelance, je construis des automatisations pour des PME. D'apres mes estimations, sur un volume comme le votre, la collecte et le rapprochement avec la facturation pourraient etre traites automatiquement. Ce n'est pas un gros chantier. Je vous laisse mon lien si vous voulez qu'on en parle.`,

  // Ouverture par le signal repere.
  `Bonjour, j'ai vu que vous ouvrez un second atelier a Caen. Axel Remillat, ingenieur freelance en IA : j'aide des PME a automatiser leurs process avant qu'ils ne saturent. Une ouverture, c'est souvent le moment ou le suivi des commandes et les relances fournisseurs commencent a couter cher en temps. Sans vouloir paraitre intrusif, c'est exactement ce que je sais outiller. On en parle 30 minutes ?`,

  // Ouverture par la reference metier.
  `Bonjour, dans le froid industriel, la tracabilite des fluides et les rapports d'intervention finissent presque toujours par se faire a la main, le soir. Axel Remillat, ingenieur freelance en IA, je fabrique des automatisations pour ce type de metier. Chez vous, vu la taille de l'equipe technique, ca pourrait representer plusieurs milliers d'euros par an. J'ai deja mene ce genre de chantier en entreprise. Je vous mets mon lien si vous voulez creuser.`,
];

/**
 * Banque de nuances. Le modele en pioche UNE OU DEUX, jamais les memes d'un
 * mail a l'autre. Les imposer toutes produisait un tic reconnaissable.
 */
const HEDGES = [
  "il me semble que",
  "sans vouloir paraitre intrusif",
  "d'apres mes estimations",
  "pourrait",
  "si je ne me trompe pas",
  "de ce que j'en vois",
  "souvent",
  "a priori",
];

/** Plusieurs facons VRAIES de dire la meme chose. Optionnelle. */
const SOCIAL_PROOFS = [
  "j'ai deja mis en place ce type d'automatisation dans des projets en startup et en entreprise",
  "j'ai deja construit ce genre de systeme, en startup comme en entreprise",
  "c'est le type de chantier que j'ai deja mene, cote startup et cote entreprise",
];

/** Fins possibles. Varier evite la signature mecanique. */
const CLOSINGS = [
  "un echange de 30 minutes",
  "30 minutes pour en parler",
  "un rapide appel si le sujet vous parle",
  "quelques minutes pour voir si ca a du sens chez vous",
];

export interface WritingInput {
  tone: ToneKey;
  /**
   * Graine de variation — le nom de l'entreprise. Elle decide QUELLE preuve
   * sociale, QUELLE fin et QUELLES nuances sont proposees. Laisser le modele
   * choisir dans une liste ne suffisait pas : il prenait toujours la premiere,
   * et deux mails d'affilee se terminaient pareil.
   */
  seed: string;
  /** Sortie de l'etape 1 : c'est elle qui porte la specificite. */
  analysis: DeepAnalysis;
  /**
   * Ouvertures et fins des derniers mails generes. Le modele a interdiction de
   * les reutiliser : c'est le principal levier anti-repetition.
   */
  avoid: string[];
}

/**
 * ETAPE 2 — la redaction, a partir du JSON d'analyse.
 *
 * Le modele n'analyse plus rien ici : il met en mots un diagnostic deja pose.
 * Cela libere la temperature pour le style sans relacher la rigueur du fond.
 */
export function buildWritingPrompt(input: WritingInput): string {
  const { analysis, avoid } = input;

  // Rotation deterministe : meme entreprise -> meme choix, entreprises
  // differentes -> formulations differentes.
  let hash = 0;
  for (const char of input.seed) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  const pick = <T,>(list: readonly T[], offset: number): T => list[(hash + offset) % list.length];

  const socialProof = pick(SOCIAL_PROOFS, 0);
  const closing = pick(CLOSINGS, 1);
  // Trois nuances proposees sur huit : le modele en retient une ou deux.
  const hedges = [pick(HEDGES, 2), pick(HEDGES, 5), pick(HEDGES, 7)];

  const avoidBlock = avoid.length
    ? `INTERDIT DE REUTILISER — ouvertures et fins de tes derniers mails. Aucune
de ces phrases, ni une variante proche :
${avoid.map((line) => `- ${line}`).join("\n")}`
    : "";

  return `Tu ecris un email de prospection a froid A LA PLACE d'Axel. Tu n'es pas un
assistant qui redige pour lui : tu es lui. Premiere personne, sa voix.

${personaBlock()}

CE QUE L'ANALYSE A ETABLI — c'est ta matiere, utilise-la
- Leur metier : ${analysis.business_model}
- Le process a adresser : ${analysis.pain_point}
- Pourquoi eux, precisement : ${analysis.pourquoi_lui}
- Angle d'accroche : ${analysis.angle}
- Detail unique a cette entreprise : ${analysis.detail_unique}

REGLES NON NEGOCIABLES
1. L'accroche DOIT contenir le detail unique ci-dessus, ou s'y referer
   clairement. Un mail qui pourrait partir a une autre entreprise est rate.
2. Le process nomme est celui de l'analyse, dans le vocabulaire du metier.
   Jamais "processus administratifs", "back-office", "gagner en efficacite",
   "optimiser vos processus".
3. Aucun chiffre precis invente. Les ordres de grandeur flous et nuances sont
   permis ("plusieurs milliers d'euros par an", "pas mal de temps") ; un nombre
   precis ne l'est jamais.
4. Objet du mail : specifique a CETTE entreprise, lisible seul. Jamais
   "optimisation de vos processus" ni une formule interchangeable.

LA VOIX
- Ton humain, chaleureux mais professionnel. Quelqu'un qui ecrit a quelqu'un.
- Nuances : choisis UNE OU DEUX tournures dans cette banque, pas plus, et
  change d'un mail a l'autre. Pour celui-ci : ${hedges.join(" / ")}
- Preuve sociale : OPTIONNELLE, et si tu la mets, c'est CELLE-CI, mot pour mot
  ou presque : « ${socialProof} ». Rien au-dela : aucun nom de client, aucun
  chiffre de portefeuille. Si elle alourdit le mail, supprime-la.
- Fin : propose « ${closing} ». Ne reprends pas une autre formule de cloture.
- Zero jargon corporate, zero formule creuse ("acteur incontournable", "je me
  permets de vous solliciter", "solution innovante", "j'espere que vous allez
  bien"). Pas d'emoji, pas de markdown, aucun crochet a completer.
- Varie le rythme : des phrases courtes, une plus longue. Pas quatre phrases de
  meme longueur a la suite.

STRUCTURE — variable, c'est voulu
L'ordre des blocs peut changer : ouvre sur le detail unique, sur une question,
sur le signal, ou sur une observation metier. Tu dois seulement dire qui tu es
quelque part dans les deux premieres phrases, poser l'hypothese, proposer un
echange et signer "Axel". Longueur : 60 a 130 mots.

${avoidBlock}

QUATRE EXEMPLES DE LA VOIX — quatre ouvertures differentes, pour montrer le
registre. N'en reutilise AUCUNE phrase : ce sont des exemples de ton, pas des
modeles a remplir.
${VOICE_EXAMPLES.map((example, index) => `Exemple ${index + 1} :\n${example}`).join("\n\n")}

REGISTRE DEMANDE
${toneInstruction(input.tone)}

Reponds UNIQUEMENT avec un objet JSON :
{ "email": { "subject": "objet court, specifique a cette entreprise", "body": "corps de l'email" } }`;
}

/** Formate un montant en euros, sans inventer de precision. */
function euros(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Serialise le prospect en un contexte compact.
 *
 * On liste aussi explicitement ce qui MANQUE : un modele a qui l'on dit
 * « effectif inconnu » invente nettement moins qu'un modele face a un silence.
 */
export function buildContext(prospect: Prospect): string {
  const figures = prospect.key_figures ?? {};

  const known: string[] = [];
  const missing: string[] = [];

  const add = (label: string, value: string | null) => {
    if (value) known.push(`${label} : ${value}`);
    else missing.push(label.toLowerCase());
  };

  known.push(`Entreprise : ${prospect.company_name}`);
  add("Secteur", str(prospect.sector));
  add("Tranche d'effectif", str(prospect.size_range) ?? str(figures.size_range));
  add(
    "Effectif precis",
    num(figures.headcount) !== null ? `${num(figures.headcount)} salaries` : null,
  );
  add("Ville", str(prospect.city));
  add("Site web", str(prospect.website));
  add("SIREN", str(prospect.siren));
  add("Forme juridique", str(figures.legal_form));
  add("Code NAF", str(figures.naf_code));
  add(
    "Annee de creation",
    num(figures.founded_year) !== null ? String(num(figures.founded_year)) : null,
  );

  const revenue = num(figures.revenue_eur);
  const revenueYear = num(figures.revenue_year);
  add(
    "Chiffre d'affaires",
    revenue !== null ? `${euros(revenue)}${revenueYear ? ` (exercice ${revenueYear})` : ""}` : null,
  );
  add("Resultat net", num(figures.net_income_eur) !== null ? euros(figures.net_income_eur as number) : null);
  add("Capital social", num(figures.capital_eur) !== null ? euros(figures.capital_eur as number) : null);

  const leader = str(figures.leader);
  const leaderRole = str(figures.leader_role);
  add("Dirigeant", leader ? `${leader}${leaderRole ? ` (${leaderRole})` : ""}` : null);
  add("Contact connu", str(prospect.email));

  // Signaux : on ne transmet que ce qui est ATTESTE, et on transmet la
  // CITATION de la source plutot que le libelle interne — c'est elle que le
  // modele doit reprendre. Les deductions structurelles sont marquees comme
  // telles pour qu'il ne les presente jamais comme une actualite.
  const attested = (prospect.signals ?? []).filter(
    (signal) => str(signal.quote) && str(signal.url),
  );

  const signals = attested.slice(0, 6).map((signal, index) => {
    const quote = str(signal.quote) ?? str(signal.label) ?? "";
    const meta = [str(signal.source), str(signal.date)].filter(Boolean).join(", ");
    const cite = meta ? ` [${meta}]` : "";
    return `${index + 1}. "${quote.slice(0, 220)}"${cite} — ${str(signal.url)}`;
  });

  const deductions = (prospect.signals ?? [])
    .filter((signal) => signal.type === "structure")
    .slice(0, 3)
    .map((signal) => `- ${str(signal.label)}`);

  const painPoint = str(prospect.pain_point);

  return [
    "DONNEES REELLES COLLECTEES SUR CE PROSPECT",
    "(sources : annuaire public des entreprises, Pappers, recherche web, Hunter)",
    "",
    known.join("\n"),
    painPoint ? `\nPain point deja note par l'utilisateur : ${painPoint}` : "",
    "",
    signals.length
      ? `SIGNAUX WEB ATTESTES — citations exactes de leurs sources (${signals.length}) :\n${signals.join("\n")}`
      : "SIGNAUX WEB : aucun signal atteste. N'en invente pas, n'evoque " +
        "aucune actualite, aucune levee de fonds et aucun recrutement les concernant.",
    deductions.length
      ? "DEDUCTIONS STRUCTURELLES (ce ne sont PAS des actualites, ne les " +
        "presente jamais comme des evenements) :\n" +
        deductions.join("\n")
      : "",
    "",
    missing.length
      ? `DONNEES INDISPONIBLES — ne les invente pas, n'y fais aucune allusion chiffree : ${missing.join(", ")}.`
      : "Toutes les donnees usuelles sont disponibles ci-dessus.",
  ]
    .filter((block) => block !== "")
    .join("\n");
}

/** Un fait reel retenu pour justifier le pain point, avec sa provenance. */
/** Un fait REEL retenu par l'analyse, avec sa provenance. */
export interface Evidence {
  label: string;
  value: string;
  source: string;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Montants en euros presents dans un texte, normalises en nombres.
 * Sert de garde-fou : un montant qui n'est pas dans les donnees reelles est
 * signale a l'utilisateur avant envoi.
 */
export function extractEuroAmounts(text: string): number[] {
  const matches = text.matchAll(/(\d[\d\s., ]*)\s*(?:€|eur\b|euros\b)/gi);
  const amounts: number[] = [];
  for (const match of matches) {
    const raw = match[1].replace(/[\s. ]/g, "").replace(",", ".");
    const value = Number(raw);
    if (Number.isFinite(value)) amounts.push(Math.round(value));
  }
  return amounts;
}

/** Valide la sortie de l'etape 2 ; renvoie null si elle est inexploitable. */
export function parseEmail(raw: string): GeneratedEmail | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const email = ((parsed as Record<string, unknown>).email ?? {}) as Record<string, unknown>;
  const body = asString(email.body);
  if (!body) return null;

  return {
    subject: asString(email.subject, "Une piste d'automatisation"),
    body,
  };
}
