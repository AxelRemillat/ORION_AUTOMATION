/**
 * PRÉ-FILTRE GRATUIT des annonces reçues du flux RSS Codeur — AVANT tout appel
 * LLM. Raisonne sur la LISTE des catégories ET le texte (titre + extrait) :
 * Codeur met parfois une virgule dans une catégorie (« Admin système,
 * sécurité »), une égalité stricte raterait des cas.
 *
 * Écarte ce qu'Axel ne fait pas : app mobile, site complet, SEO / rédaction /
 * community management / vidéo / graphisme / 3D, télémarketing, secrétariat ou
 * saisie manuelle, formation en présentiel hors Île-de-France, budget < 150 €.
 * Une annonce écartée est GARDÉE (statut « Ignorée », motif) pour audit.
 */

export interface PrefilterInput {
  title: string;
  description: string;
  categories: readonly string[];
  budgetText: string | null;
}

const plain = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’]/g, "'");

/** Ce qu'Axel fait : une annonce qui en parle n'est pas écartée pour une catégorie « site » ou « saisie ». */
const AUTOMATION_SIGNAL = /(automatis|n8n|make\.com|zapier|\bapi\b|agent (ia|intelligent)|chatbot|\brag\b|workflow|integration|connect(er|eur)|\bia\b|intelligence artificielle|gpt|llm|openai|extraction|script)/;

interface Rule {
  reason: string;
  /** Sur le texte (titre + extrait), sans accents, en minuscules. */
  text?: RegExp;
  /** Sur chaque catégorie, sans accents, en minuscules. */
  category?: RegExp;
  /** La règle ne s'applique pas si l'annonce parle d'automatisation. */
  unlessAutomation?: boolean;
}

const RULES: readonly Rule[] = [
  {
    reason: "application mobile (iOS / Android)",
    text: /(app(lication)? (mobile|ios|android|iphone)|\bios\b|\bandroid\b|flutter|react native|\bswift\b|\bkotlin\b|app store|play store|apple store)/,
    category: /(mobile|ios|android|iphone)/,
  },
  {
    reason: "création ou refonte de site (vitrine, e-commerce, WordPress, Wix, Shopify…)",
    text: /(site vitrine|boutique en ligne|site e-?commerce|(creation|refonte|realisation|developpement) (d'un |de mon |de notre |du |de )?(site|boutique)|site (wordpress|wix|shopify|prestashop|webflow))/,
  },
  {
    reason: "site internet (catégorie), sans automatisation demandée",
    category: /(site internet|site vitrine|e-?commerce|wordpress|wix|shopify|prestashop|webflow|woocommerce)/,
    unlessAutomation: true,
  },
  {
    reason: "SEO, rédaction, community management, vidéo, graphisme ou 3D",
    text: /(\bseo\b|referencement naturel|redaction (d'articles|web|de contenus?)|redacteur|community manag|gestion des reseaux sociaux|\bvideos?\b|montage video|motion design|graphis|\blogo\b|illustration|\b3d\b|modelisation|blender|animation 2d)/,
    category: /(seo|referencement|redaction|community|reseaux sociaux|video|graphis|design graphique|logo|3d|illustration|animation|photo)/,
  },
  {
    reason: "télémarketing / prospection téléphonique humaine",
    text: /(telemarketing|teleprospect|prospection telephonique|phoning|call center|centre d'appels|appels sortants|prise de rendez-vous telephonique)/,
    category: /(telemarketing|teleprospection|centre d'appel)/,
  },
  {
    reason: "secrétariat / saisie manuelle",
    text: /(secretariat|saisie manuelle|operat(eur|rice) de saisie|data entry|assistante? (administrative|virtuelle))/,
    category: /(secretariat|saisie de donnees|assistanat)/,
    unlessAutomation: true,
  },
];

/** Formation en présentiel hors Île-de-France. */
const TRAINING = /(formation|formateur|formatrice)/;
const ON_SITE = /(presentiel|sur site|en salle|dans nos locaux)/;
const IDF_OR_REMOTE = /(paris|ile-de-france|\bidf\b|\b(75|77|78|91|92|93|94|95)\d{3}\b|distanc|visio|en ligne|teletravail|remote)/;

/** Budget explicitement inférieur à 150 € (« Moins de 100 € », « 50 € »…). */
export function budgetBelow(budgetText: string | null | undefined, threshold = 150): boolean {
  const text = plain(budgetText ?? "");
  if (!text) return false;
  const amounts = [...text.matchAll(/(\d[\d\s.]*)\s*(€|eur)/g)].map((match) => Number(match[1].replace(/[\s.]/g, ""))).filter((value) => Number.isFinite(value) && value > 0);
  if (!amounts.length) return false;
  if (/moins de/.test(text)) return Math.min(...amounts) <= threshold;
  return Math.max(...amounts) < threshold;
}

/** Motif d'exclusion, ou `null` si l'annonce passe à l'analyse. */
export function prefilterReason(input: PrefilterInput): string | null {
  const text = plain(`${input.title}\n${input.description}`);
  const categories = input.categories.map(plain);
  const automation = AUTOMATION_SIGNAL.test(`${text} ${categories.join(" ")}`);
  for (const rule of RULES) {
    if (rule.unlessAutomation && automation) continue;
    if (rule.text?.test(text) || (rule.category && categories.some((category) => rule.category!.test(category)))) return rule.reason;
  }
  if (TRAINING.test(text) && ON_SITE.test(text) && !IDF_OR_REMOTE.test(text)) return "formation en présentiel hors Île-de-France";
  if (budgetBelow(input.budgetText)) return "budget inférieur à 150 €";
  return null;
}
