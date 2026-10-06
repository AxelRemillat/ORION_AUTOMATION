/**
 * PRÉ-FILTRE GRATUIT des annonces reçues du flux RSS Codeur — AVANT tout appel
 * LLM. Raisonne sur la LISTE des catégories ET le texte (titre + extrait) :
 * Codeur met parfois une virgule dans une catégorie (« Admin système,
 * sécurité »), une égalité stricte raterait des cas.
 *
 * Écarte ce qu'Axel ne fait pas : app mobile native, site vitrine / CMS /
 * e-commerce clé en main, PHP / Laravel / Symfony / Windev / .NET / Java, jeu
 * vidéo, SEO / rédaction / community management / vidéo / graphisme / design /
 * 3D, télémarketing, secrétariat ou saisie manuelle, formation en présentiel
 * hors Île-de-France, budget < 150 €. Le full-stack sur sa stack (React /
 * Next.js, Node.js, Supabase…) passe (décision d'Axel, 06/10/2026).
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
const AUTOMATION_SIGNAL = /(automatis|automatique|n8n|make\.com|zapier|\bapi\b|agent (ia|intelligent)|chatbot|\brag\b|workflow|integration|connect(er|eur)|\bia\b|intelligence artificielle|gpt|llm|openai|extraction|script)/;

interface Rule {
  reason: string;
  /** Sur le texte (titre + extrait), sans accents, en minuscules. */
  text?: RegExp;
  /** Sur chaque catégorie, sans accents, en minuscules. */
  category?: RegExp;
  /** La règle ne s'applique pas si l'annonce parle d'automatisation. */
  unlessAutomation?: boolean;
}

/** Application web sur mesure sur la stack d'Axel (full-stack, décision du 06/10/2026). */
const FULLSTACK_SIGNAL = /(react|next\.?js|node\.?js|supabase|postgres|firebase|sur mesure|\bsaas\b|application web|appli(cation)? web|plate-?forme|\bmvp\b|dashboard|tableau de bord|\bcrm\b|outil interne|back-?office|api rest)/;
/** CMS et e-commerce clés en main : toujours hors périmètre, même « sur mesure ». */
const CMS = /(wordpress|\bwix\b|shopify|webflow|squarespace|prestashop|magento|woocommerce|jimdo)/;
const SITE_CREATION = /(site vitrine|boutique en ligne|site e-?commerce|(creation|refonte|realisation|developpement) (d'un |de mon |de notre |du |de )?(site|boutique))/;
const SITE_CATEGORY = /(site internet|site vitrine|e-?commerce|wordpress|wix|shopify|prestashop|webflow|woocommerce|magento)/;
/** React Native, Flutter : pas exclus (l'analyse les plafonne à 6). */
const CROSS_PLATFORM = /(react native|flutter|\bexpo\b)/;

const NATIVE_TEXT = /(\bios\b|\bandroid\b|iphone|\bapple\b|\bswift\b|\bkotlin\b|app store|play store|apple store)/;
const NATIVE_CATEGORY = /(\bios\b|android|iphone)/;
const MOBILE = /(app(lication|li)? mobile|mobile app)/;
/** Un projet web (plateforme, SaaS, back-office…) n'est pas une app mobile native, même s'il en a aussi une. */
const WEB_SIGNAL = /(\bweb\b|\bsaas\b|plate-?forme|site|logiciel|back-?office|back-end|dashboard|tableau de bord)/;

/**
 * Application mobile NATIVE : iOS / Android / Swift / Kotlin nommés, ou une
 * app « mobile » sans aucun volet web. React Native / Flutter : jamais ici.
 */
function mobileReason(text: string, categories: readonly string[]): string | null {
  if (CROSS_PLATFORM.test(text)) return null;
  const all = `${text} ${categories.join(" ")}`;
  const native = NATIVE_TEXT.test(text) || categories.some((category) => NATIVE_CATEGORY.test(category));
  const mobileOnly = (MOBILE.test(text) || categories.some((category) => /mobile/.test(category))) && !WEB_SIGNAL.test(all);
  return native || mobileOnly ? "application mobile native (iOS / Android)" : null;
}

/** « sans Shopify », « plutôt que WordPress » : un CMS cité pour l'écarter n'en fait pas un projet CMS. */
const NEGATED_CMS = /(sans|hors|pas de|pas sur|plutot que|au lieu de|autre que) (wordpress|wix|shopify|webflow|squarespace|prestashop|magento|woocommerce)/g;

const RULES: readonly Rule[] = [
  {
    reason: "langage hors stack (PHP, Laravel, Symfony, Windev, .NET, Java)",
    text: /(\bphp\b|laravel|symfony|windev|webdev|asp\.net|vb\.net|\.net\b|\bc#|\bjava\b|spring boot|j2ee|cakephp|codeigniter)/,
    category: /(\bphp\b|laravel|symfony|windev|\.net|\bjava\b)/,
  },
  {
    reason: "jeu vidéo",
    text: /(jeux? video|\bunity\b|unreal engine|\bgaming\b|game design)/,
    category: /(jeux? video|\bjeu\b)/,
  },
  {
    reason: "SEO, rédaction, community management, vidéo, graphisme, design ou 3D",
    text: /(\bseo\b|referencement naturel|redaction (d'articles|web|de contenus?)|redacteur|community manag|gestion des reseaux sociaux|(creation|realisation|montage|production|tournage|faire|creer|generer) (de |d'une |d'un |des |une |un |de la )?(serie de )?videos?|videos? (ia|ugc|tiktok|youtube|instagram|publicitaires?|photorealistes?|pedagogiques?|premium|faceless)|monteur|editeur video|montage video|motion design|graphis|\blogo\b|illustration|\b3d\b|modelisation|blender|animation 2d|webdesign|ux designer|ui designer|designer ui)/,
    category: /(seo|referencement|redaction|community|reseaux sociaux|video|graphis|\bdesign\b|logo|3d|illustration|animation|photo)/,
  },
  {
    reason: "télémarketing / prospection téléphonique humaine",
    // Un RÔLE humain (téléprospecteur, commercial freelance…) : toujours hors périmètre.
    text: /(teleprospect(eur|rice|eurs)|teleoperat|televendeu|commercial(e|·e)? freelance|apporteur d'affaires?|centre d'appels|call center|phoning)/,
  },
  {
    reason: "télémarketing / prospection téléphonique humaine",
    // Le sujet seul : exclu, sauf s'il s'agit de l'automatiser (« une IA qui appelle »).
    text: /(telemarketing|prospection telephonique|appels sortants|prise de rendez-vous telephonique)/,
    category: /(telemarketing|teleprospection|centre d'appel)/,
    unlessAutomation: true,
  },
  {
    reason: "secrétariat / saisie manuelle",
    text: /(secretariat|saisie manuelle|operat(eur|rice) de saisie|data entry|assistante? (administrative|virtuelle))/,
    category: /(secretariat|saisie de donnees|assistanat)/,
    unlessAutomation: true,
  },
];

/**
 * Site vitrine, CMS, e-commerce clé en main : exclus — sauf intégration ou
 * automatisation demandée (« synchroniser Shopify avec l'ERP via n8n »), ou
 * application web sur mesure sur la stack d'Axel (sans CMS).
 */
/**
 * CŒUR DE CIBLE (Cowork, 06/10/2026 — alerte ratée sur « Agent IA, et refonte
 * site web », Codeur 490837 : refonte d'un INTRANET métier + agents IA, écartée
 * par la catégorie « Migration ou refonte de site »). Le moindre de ces signaux,
 * dans le texte OU les catégories, suspend le filtre « site » : en cas de doute,
 * c'est l'analyse LLM qui tranche.
 */
const CORE_SIGNAL = new RegExp(
  [
    "agent", "\\bia\\b", "intelligence artificielle", "automatis", "intranet", "extranet", "outil interne", "application metier", "logiciel",
    "\\berp\\b", "\\bcrm\\b", "\\bapi\\b", "base de donnees", "\\bsaas\\b", "dashboard", "tableau de bord", "back-?office",
    "supabase", "react", "next\\.?js", "node\\.?js", "postgres", "firebase", "planning", "gestion de stock", "\\bsav\\b",
  ].join("|"),
);

function siteReason(rawText: string, categories: readonly string[], automation: boolean): string | null {
  const text = rawText.replace(NEGATED_CMS, " ");
  const cms = CMS.test(text) || categories.some((category) => CMS.test(category));
  const site = SITE_CREATION.test(text) || categories.some((category) => SITE_CATEGORY.test(category)) || cms;
  if (!site || automation) return null;
  if (CORE_SIGNAL.test(`${text} ${categories.join(" ")}`)) return null;
  if (!cms && FULLSTACK_SIGNAL.test(text)) return null;
  return cms ? "site ou e-commerce sur CMS (WordPress, Wix, Shopify, Webflow, PrestaShop…)" : "création ou refonte de site vitrine / e-commerce";
}

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
  const mobile = mobileReason(text, categories);
  if (mobile) return mobile;
  for (const rule of RULES) {
    if (rule.unlessAutomation && automation) continue;
    if (rule.text?.test(text) || (rule.category && categories.some((category) => rule.category!.test(category)))) return rule.reason;
  }
  const site = siteReason(text, categories, automation);
  if (site) return site;
  if (TRAINING.test(text) && ON_SITE.test(text) && !IDF_OR_REMOTE.test(text)) return "formation en présentiel hors Île-de-France";
  if (budgetBelow(input.budgetText)) return "budget inférieur à 150 €";
  return null;
}
