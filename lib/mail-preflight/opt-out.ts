/**
 * LA PHRASE D'OPPOSITION — obligatoire dans tout mail de prospection.
 *
 * Un mail de prospection à froid doit offrir un moyen simple de ne plus être
 * contacté : c'est le droit d'opposition de l'article 21 du RGPD, et l'article
 * 56 de la loi Informatique et Libertés pour la prospection. Une phrase suffit,
 * à condition qu'elle soit là et qu'on l'honore.
 *
 * Elle ne compte PAS dans les 110 mots : c'est une mention légale, pas de
 * l'argumentaire, et l'y inclure poussait à la retirer pour tenir la longueur.
 *
 * Elle se place juste AVANT la signature. La règle est bloquante : un mail sans
 * elle ne part pas.
 *
 * SOURCE UNIQUE du texte : le générateur (premier mail et relances), le
 * contrôle avant envoi et le bouton « Ajouter la mention » lisent tous cette
 * constante.
 */

export const OPT_OUT_SENTENCE =
  "Si le sujet ne vous concerne pas, un simple « stop » en réponse et je ne vous relancerai pas.";

/**
 * Reconnaissance TOLÉRANTE : le rédacteur peut reformuler, et une variante
 * honnête reste valable. On exige les deux éléments qui font la mention : le
 * mot d'arrêt (« stop ») et l'engagement à ne plus relancer.
 *
 * Guillemets droits ou courbes, « STOP » en capitales, espaces insécables,
 * apostrophe droite ou typographique, accent oublié : une retouche à la main
 * ne doit pas bloquer un mail qui porte bien la mention.
 */
const STOP_WORD = /(^|[^\p{L}])stop([^\p{L}]|$)/iu;
const NO_FOLLOW_UP =
  /(relanc\p{L}*|recontact\p{L}*|plus de (messages?|mails?|nouvelles)|n'?\s*[eé]crirai plus|ne vous [eé]cri(?:s|rai) plus)/iu;

/** Espaces (insécables comprises) ramenées à une seule, guillemets et apostrophes unifiés. */
const flatten = (text: string) =>
  (text ?? "")
    .replace(/[\s   ]+/g, " ")
    .replace(/[«»“”„]/g, '"')
    .replace(/[‘’´`]/g, "'");

const carriesOptOut = (text: string) => {
  const flat = flatten(text);
  return STOP_WORD.test(flat) && NO_FOLLOW_UP.test(flat);
};

export function hasOptOut(body: string): boolean {
  return carriesOptOut(body);
}

/** Lignes de la phrase, pour la retirer du texte compté. */
export function withoutOptOut(body: string): string {
  return (body ?? "")
    .split(/\n/)
    .filter((line) => !carriesOptOut(line))
    .join("\n");
}

/** Formule de politesse qui précède la signature : la phrase se place avant elle. */
const CLOSING = /^(bien (à|a) vous|bien cordialement|cordialement|belle journée|bonne journée|à bientôt|a bientot)/i;

/**
 * Premier bloc (séparé par une ligne vide) qui appartient à la signature, ou
 * `blocks.length` si rien n'y ressemble. Sert quand la signature n'est pas
 * connue : brouillon édité à la main, mail programmé retouché au Cockpit.
 */
function signOffStart(blocks: string[]): number {
  if (blocks.length < 2) return blocks.length;
  let start = blocks.length;
  const last = blocks[blocks.length - 1];
  const lines = last.split("\n");
  const firstLineWords = lines[0].trim().split(/\s+/).length;
  if (lines.length <= 3 && !last.includes("?") && firstLineWords <= 4) start -= 1;
  if (start > 1 && CLOSING.test(blocks[start - 1].trim())) start -= 1;
  return start;
}

/**
 * Insère la phrase juste avant la signature, si elle manque. `sentence` : la ligne qui dit aussi d'où vient
 * l'adresse (lib/mail-preflight/contact-origin.ts, Cowork #59) ; à défaut, la phrase d'avant.
 *
 * `signature` est le bloc posé par le code (lib/offer/model.ts). Sans lui, on
 * reconnaît la signature à sa forme (dernier bloc court, formule de politesse)
 * pour ne pas écrire la mention SOUS le nom de l'expéditeur.
 */
export function withOptOut(body: string, signature?: string | null, sentence: string = OPT_OUT_SENTENCE): string {
  if (hasOptOut(body)) return body;
  const text = (body ?? "").trimEnd();
  const sign = (signature ?? "").trim();

  if (sign && text.endsWith(sign)) {
    const head = text.slice(0, text.length - sign.length).trimEnd();
    return `${head}\n\n${sentence}\n\n${sign}`;
  }
  const blocks = text.split(/\n\s*\n/);
  const at = signOffStart(blocks);
  if (at >= blocks.length) return `${text}\n\n${sentence}`;
  return [...blocks.slice(0, at), sentence, ...blocks.slice(at)].join("\n\n");
}
