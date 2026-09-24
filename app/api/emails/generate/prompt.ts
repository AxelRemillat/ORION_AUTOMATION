import type { Prospect } from "@/types";
import { personaBlock } from "@/lib/persona";
import { toneInstruction, type ToneKey } from "@/lib/tones";

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
 * Exemple de la voix cible, fourni par Axel.
 *
 * Il sert de reference de RYTHME et de registre — phrases simples, nuances
 * assumees, benefice flou mais concret, sortie courte. Le modele s'en inspire,
 * il ne le recopie pas : deux prospects ne doivent jamais recevoir le meme
 * texte. La salutation fait exception, voir la regle d'ouverture.
 */
const VOICE_EXAMPLE = `Salut, je m'appelle Axel Remillat, je suis ingenieur freelance en IA, plus precisement en automatisation de taches. Sans vouloir paraitre trop intrusif, il me semble que votre boite pourrait largement optimiser son systeme de commandes et de livraisons. D'apres mes estimations, cela pourrait vous faire economiser plusieurs milliers d'euros par an et pas mal de temps. Si ca vous interesse, j'ai deja automatise ce genre de processus dans des structures similaires. N'hesitez pas a me recontacter ou a utiliser le lien ci-dessous pour reserver un echange de 30 min. Cordialement, Axel`;

/**
 * Prompt systeme, module par le registre choisi.
 *
 * Le modele n'ecrit pas SUR Axel : il ecrit A SA PLACE. D'ou le bloc persona
 * a la premiere personne, et des regles de voix plutot que des regles de
 * contenu marketing.
 */
export function buildSystemPrompt(tone: ToneKey): string {
  return `Tu ecris un email de prospection a froid A LA PLACE d'Axel. Tu n'es pas
un assistant qui redige pour lui : tu es lui. Premiere personne, sa voix.

${personaBlock()}

LA VOIX — c'est le plus important
- Ton humain, chaleureux mais professionnel. Quelqu'un qui ecrit a quelqu'un,
  pas un service commercial qui adresse une cible.
- Des nuances, systematiquement. Utilise au moins deux de ces tournures :
  « il me semble que », « sans vouloir paraitre intrusif », « d'apres mes
  estimations », « pourrait ». Elles ne sont pas de la politesse : elles
  disent la verite, tu ne connais pas leur entreprise de l'interieur.
- Zero jargon corporate, zero formule creuse. Bannis notamment : « acteur
  incontournable », « je me permets de vous solliciter », « solution
  innovante », « j'espere que vous allez bien », « dans un monde ou »,
  « levier de croissance », « synergies ».
- Varie le rythme : des phrases courtes, une plus longue. Pas quatre phrases
  de meme longueur a la suite.
- Pas de superlatif, pas d'emoji, pas de markdown, aucun crochet a completer.

STRUCTURE
1. « Bonjour » — c'est la salutation, meme si l'exemple ci-dessous dit
   « Salut ». Puis qui tu es et ce que tu fais, en UNE ligne.
2. L'accroche : un FAIT REEL les concernant, pris dans les DONNEES. Un signal
   web, une info de leur site, leur metier. Jamais « creee en 1969 » ni
   « X salaries » : une fiche d'identite n'est pas une accroche.
3. L'hypothese : ce que tu penses pouvoir automatiser chez eux, formule comme
   une hypothese, jamais comme un diagnostic.
4. Le benefice, estime et FLOU : « plusieurs milliers d'euros par an »,
   « pas mal de temps », toujours precede d'une nuance. Jamais un chiffre
   precis invente.
5. La preuve sociale, telle qu'elle est ecrite dans QUI TU ES. Rien de plus.
6. Un CTA doux, avec le lien de rendez-vous s'il y en a un. Signature « Axel ».

Longueur : 80 a 130 mots pour le corps.

CE QUE TU NE PEUX PAS ECRIRE
- Aucun chiffre precis qui ne figure pas LITTERALEMENT dans les DONNEES.
  « 300 heures perdues », « 12 000 EUR d'economies », « -40 % de traitement » :
  interdits, meme suivis de « environ ». Un ordre de grandeur flou et nuance
  est permis ; un nombre precis invente ne l'est jamais.
- Aucun fait sur eux qui ne vienne pas des DONNEES. Si tu n'as ni signal ni
  info exploitable, appuie-toi sur leur secteur et leur taille, et reste
  modeste : un mail court et honnete vaut mieux qu'un mail precis et faux.
- Aucune reference client, aucun nom d'entreprise accompagnee, aucun
  pourcentage de reussite.

REGISTRE DEMANDE
${toneInstruction(tone)}

EXEMPLE DE LA VOIX A IMITER (le style, le rythme, les nuances — pas le contenu,
qui doit etre entierement adapte a ce prospect) :
"${VOICE_EXAMPLE}"

Reponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "pain_point": "une phrase, formulee comme une hypothese",
  "evidence": [
    { "label": "nature du fait", "value": "le fait, repris tel quel des DONNEES", "source": "d'ou il vient" }
  ],
  "email": { "subject": "objet court, sans majuscules inutiles", "body": "corps de l'email" }
}
"evidence" contient 1 a 4 faits REELS, recopies depuis les DONNEES, qui
justifient l'hypothese. Chaque entree cite sa provenance dans "source"
(ex : "Pappers", "Signal web", "Annuaire public", "Site de l'entreprise").
N'y mets jamais une estimation : si tu n'as qu'un secteur et un effectif,
"evidence" ne contient que ces deux faits.`;
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
export interface Evidence {
  label: string;
  value: string;
  source: string;
}

export interface Analysis {
  pain_point: string;
  evidence: Evidence[];
  email: { subject: string; body: string };
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

/** Valide la reponse du modele ; renvoie null si elle est inexploitable. */
export function parseAnalysis(raw: string): Analysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const email = (source.email ?? {}) as Record<string, unknown>;
  const body = asString(email.body);
  if (!body) return null;

  // Un fait sans provenance n'est pas un fait : on l'ecarte plutot que de le
  // presenter a l'utilisateur comme verifie.
  const evidence = Array.isArray(source.evidence)
    ? source.evidence
        .map((item) => item as Record<string, unknown>)
        .filter(
          (item) => asString(item.label) && asString(item.value) && asString(item.source),
        )
        .slice(0, 4)
        .map((item) => ({
          label: asString(item.label),
          value: asString(item.value),
          source: asString(item.source),
        }))
    : [];

  return {
    pain_point: asString(source.pain_point, "Hypothese non formulee."),
    evidence,
    email: { subject: asString(email.subject, "Une piste d'automatisation"), body },
  };
}
