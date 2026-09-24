import type { Prospect } from "@/types";
import type { PageContent } from "@/lib/enrichment/linkup";
import { playbookBlock, resolvePlaybook } from "@/lib/sector-playbook";

/**
 * ÉTAPE 1 — comprendre le métier avant d'écrire.
 *
 * Constat qui a motivé ce découpage : en un seul appel, le modèle sautait
 * l'analyse et produisait le même diagnostic pour tout le monde — « processus
 * administratifs à optimiser » pour une agence d'intérim comme pour un
 * frigoriste industriel. Deux appels séparés, le premier à température basse
 * et sans souci de style, forcent le raisonnement à exister.
 *
 * Sortie : un JSON que l'étape de rédaction consomme, et que l'UI affiche pour
 * que l'utilisateur voie sur quoi le mail s'appuie — et puisse choisir une
 * autre piste.
 */

export interface ProcessTrack {
  /** Un process, dans le vocabulaire du métier. */
  label: string;
  /** Pourquoi il est plausible CHEZ EUX. */
  why: string;
}

export interface DeepAnalysis {
  /** Ce que l'entreprise vend, et à qui. */
  business_model: string;
  /** Trois process candidats. Le premier est celui retenu. */
  tracks: ProcessTrack[];
  pain_point: string;
  /** La preuve qui justifie ce choix : signal, phrase du site, taille. */
  pourquoi_lui: string;
  /** Lien vérifiable quand la preuve vient d'un signal ou du site. */
  proof_url: string | null;
  /** L'angle d'attaque de l'accroche. */
  angle: string;
  /** Un élément vrai qui ne s'applique qu'à cette entreprise. */
  detail_unique: string;
  /**
   * `false` quand rien ne permettait d'être spécifique. L'UI le dit alors
   * franchement au lieu de faire passer une généralité pour une analyse.
   */
  specific: boolean;
}

/**
 * Formulations qui signent une analyse ratée : vraies pour toutes les
 * entreprises de France, donc sans valeur dans un mail à froid.
 */
const BANNED = [
  "processus administratif",
  "processus administratifs",
  "back-office",
  "back office",
  "gagner en efficacite",
  "gagner en efficacité",
  "optimiser vos processus",
  "taches administratives",
  "tâches administratives",
  "gain de productivite",
  "gain de productivité",
];

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** `true` si le texte retombe dans la généralité interdite. */
export function isGeneric(text: string): boolean {
  const haystack = normalize(text);
  return BANNED.some((term) => haystack.includes(normalize(term)));
}

export function buildAnalysisPrompt(prospect: Prospect): string {
  const playbook = resolvePlaybook(
    typeof prospect.key_figures?.naf_code === "string" ? prospect.key_figures.naf_code : null,
    prospect.sector,
  );

  return `Tu es analyste. Ta seule tache : comprendre ce que fait REELLEMENT cette
entreprise, et reperer ce qui, dans son metier, se prete a l'automatisation.
Tu n'ecris aucun email a cette etape.

${playbookBlock(playbook)}

METHODE
1. Deduis le modele economique reel : que vendent-ils, a qui, comment ils
   operent. Appuie-toi sur le code NAF, le secteur, la taille, les signaux
   attestes et surtout le CONTENU DE LEUR SITE, qui est la source la plus
   parlante.
2. Liste TROIS process operationnels specifiques a CE metier, qui sont
   typiquement automatisables. Emploie le vocabulaire du secteur : on doit
   pouvoir dire de quel metier il s'agit rien qu'en les lisant.
3. Choisis le plus pertinent et relie-le a une PREUVE : un signal date, une
   phrase de leur site, leur taille. Pas de preuve solide : dis-le.
4. Isole un "detail_unique" : un element VRAI qui ne s'applique qu'a cette
   entreprise-la. Le nom d'une prestation, une zone, une specialite, un fait
   d'actualite. C'est ce qui rendra l'accroche impossible a recycler.

INTERDIT comme pain point : "processus administratifs", "back-office",
"taches administratives", "gagner en efficacite", "optimiser vos processus".
Ces formules sont vraies pour toutes les entreprises, donc inutiles. Si tu n'as
vraiment aucune matiere, mets specific a false et dis honnetement ce qui manque.

N'invente aucun chiffre. N'affirme aucun fait absent des DONNEES.

Reponds UNIQUEMENT avec un objet JSON :
{
  "business_model": "une a deux phrases : ce qu'ils vendent, a qui",
  "tracks": [
    { "label": "process specifique au metier", "why": "pourquoi c'est plausible chez eux" },
    { "label": "...", "why": "..." },
    { "label": "...", "why": "..." }
  ],
  "pain_point": "le process retenu, formule comme une hypothese, dans le vocabulaire du metier",
  "pourquoi_lui": "la preuve precise qui justifie ce choix",
  "proof_url": "l'URL de la preuve si elle vient d'un signal ou du site, sinon null",
  "angle": "l'angle d'accroche en une phrase",
  "detail_unique": "un element vrai propre a CETTE entreprise",
  "specific": true
}
Le premier element de "tracks" doit etre le process retenu.`;
}

/** Contexte de l'etape 1 : donnees structurees + contenu du site. */
export function buildAnalysisContext(prospect: Prospect, pages: PageContent[], base: string): string {
  if (!pages.length) {
    return `${base}

SITE OFFICIEL : non lu (pas de site connu, ou lecture impossible). Appuie-toi
sur le NAF, le secteur, la taille et les signaux.`;
  }

  const site = pages
    .map((page) => `--- ${page.url} ---\n${page.markdown}`)
    .join("\n\n");

  return `${base}

CONTENU DU SITE OFFICIEL (source la plus fiable sur leur metier reel) :
${site}`;
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value.trim() : fallback;

/** Valide la sortie de l'etape 1 ; renvoie null si elle est inexploitable. */
export function parseDeepAnalysis(raw: string): DeepAnalysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const painPoint = asString(source.pain_point);
  if (!painPoint) return null;

  const tracks = Array.isArray(source.tracks)
    ? source.tracks
        .map((item) => item as Record<string, unknown>)
        .filter((item) => asString(item.label))
        .slice(0, 3)
        .map((item) => ({ label: asString(item.label), why: asString(item.why) }))
    : [];

  const url = asString(source.proof_url);

  return {
    business_model: asString(source.business_model, "Modèle économique non déterminé."),
    tracks,
    pain_point: painPoint,
    pourquoi_lui: asString(source.pourquoi_lui, "Aucune preuve explicite."),
    proof_url: url.startsWith("http") ? url : null,
    angle: asString(source.angle),
    detail_unique: asString(source.detail_unique),
    // Le modele peut se declarer specifique tout en sortant une generalite :
    // c'est le texte qui tranche, pas son auto-evaluation.
    specific: source.specific !== false && !isGeneric(painPoint),
  };
}
