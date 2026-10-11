/**
 * PRÉ-FILTRE GRATUIT des annonces reçues du flux RSS Codeur — AVANT tout appel
 * LLM. Raisonne sur la LISTE des catégories ET le texte (titre + extrait) :
 * Codeur met parfois une virgule dans une catégorie (« Admin système,
 * sécurité »), une égalité stricte raterait des cas.
 *
 * Écarte ce qu'Axel ne fait pas : app mobile native, e-commerce lourd (Magento,
 * catalogue de plus de 100 produits), PHP / Laravel / Symfony / Windev / .NET /
 * Java, jeu vidéo, graphisme / design / vidéo / 3D, SEO / rédaction / Ads /
 * community management SANS création de site, data science lourde,
 * télémarketing, secrétariat ou saisie manuelle, formation en présentiel hors
 * Île-de-France, budget < 150 €. Le full-stack sur sa stack (React / Next.js,
 * Node.js, Supabase…) passe (décision d'Axel, 06/10/2026).
 *
 * DÉVELOPPEMENT WEB ACCEPTÉ (décision d'Axel, 11/10/2026 — premières missions,
 * premiers avis) : site vitrine, landing page, site d'affiliation, blog, refonte
 * de site, site + base SEO, application web / SaaS / plateforme sur mesure, MVP.
 * CMS IMPOSÉ (WordPress, Wix, Shopify…) : plus jamais ignoré, « À voir » avec la
 * mention « CMS imposé : à vous de juger », sans alerte (voir `classifyAd`).
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
  /** La règle ne s'applique pas si l'annonce demande de CRÉER un site ou une application web (SEO de base d'un projet de site). */
  unlessWebDev?: boolean;
}

/** CMS imposé (11/10/2026 : « À voir », plus jamais ignoré) ; Magento reste exclu par sa règle. */
const CMS = /(wordpress|\bwix\b|shopify|webflow|squarespace|presta?s?hop|magento|woocommerce|jimdo|joomla|drupal|elementor|\bdivi\b)/;
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
    reason: "vidéo, graphisme, design ou 3D",
    text: /((creation|realisation|montage|production|tournage|faire|creer|generer) (de |d'une |d'un |des |une |un |de la )?(serie de )?videos?|videos? (ia|ugc|tiktok|youtube|instagram|publicitaires?|photorealistes?|pedagogiques?|premium|faceless)|monteur|editeur video|montage video|motion design|graphis|\blogo\b|illustration|\b3d\b|modelisation|blender|animation 2d|ux designer|ui designer|designer ui)/,
    category: /(video|graphis|logo|3d|illustration|animation|photo)/,
  },
  {
    // Sans création de site : « Campagne Google Ads pour site WordPress », « Rédaction d'articles SEO ».
    reason: "SEO, rédaction, publicité (Ads) ou community management sans création de site",
    text: /(\bseo\b|referencement|redaction (d'articles|web|de contenus?)|redacteur|community manag|gestion des reseaux sociaux|google ads|\bads\b|\bsea\b|adwords|campagnes? (publicitaires?|google|facebook|meta)|webdesign)/,
    category: /(seo|referencement|redaction|community|reseaux sociaux|publicite|\bdesign\b)/,
    unlessWebDev: true,
  },
  {
    reason: "data science lourde (modèles, apprentissage automatique)",
    text: /(data scien|machine learning|deep learning|apprentissage automatique|entrainement (d'un |de )?modeles?|vision par ordinateur|computer vision|modele predictif)/,
    category: /(data science|machine learning|intelligence artificielle - data)/,
  },
  {
    reason: "e-commerce lourd (Magento, catalogue de plus de 100 produits)",
    text: /(magento)/,
    category: /(magento)/,
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
 * DÉVELOPPEMENT WEB (11/10/2026) : créer ou refaire un site, une landing page, un blog,
 * un site d'affiliation, une application web, un SaaS, une plateforme, un MVP.
 * « Application » seule compte (« Application éducative… ») : la règle mobile passe avant.
 */
const WEB_DEV = new RegExp(
  [
    "site vitrine", "landing ?page", "page de destination", "site (d'|d )?affiliation", "one ?page",
    "(creation|creer|refonte|refaire|realisation|realiser|developpement|developper|construire|conception|concevoir|nouveau|mise en place) (d'un |de mon |de notre |du |de |d'une |une |un |mon |notre |le |la )?(site|blog|landing|application|appli|plate-?forme|saas|mvp|outil)",
    "^(un |mon |notre |nouveau )?site (web|internet|vitrine)", "application (web|educative|en ligne|sur mesure|de gestion|metier|saas)", "appli(cation)? web", "\\bsaas\\b", "\\bmvp\\b", "plate-?forme (web|en ligne|sur mesure|de mise en relation|educative)",
    "^(site|application|appli|plate-?forme|landing|blog)\\b",
  ].join("|"),
);

/** Pas un projet à développer : test, paramétrage d'un logiciel d'éditeur (Zoho, Salesforce…), maintenance seule. */
const NOT_WEB_DEV = /(testeur|beta[- ]?test|tester (mon|notre|le|la)|zoho|salesforce|hubspot|odoo|dynamics 365|sap|parametrage|maintenance seule)/;

/**
 * Annonce de développement web (site, landing, blog, application web, SaaS, MVP) : texte,
 * ou catégorie précise (« Site internet », « Site vitrine »…). La catégorie Codeur
 * « Développement web », trop large (paramétrage de CRM…), ne suffit pas.
 */
export function isWebDev(text: string, categories: readonly string[] = []): boolean {
  const value = plain(text);
  if (NOT_WEB_DEV.test(value)) return false;
  if (WEB_DEV.test(value)) return true;
  // Une catégorie seule ne suffit pas pour une campagne publicitaire (« Landing page » d'une campagne Meta).
  if (/(campagne|publicit|ads|community manag)/.test(value)) return false;
  return categories.map(plain).some((category) => /(site internet|site vitrine|landing|blog)/.test(category));
}

/** Catalogue de plus de 100 produits (« catalogue de 300 produits », « 1 500 références »). */
function heavyCatalog(text: string): boolean {
  return [...text.matchAll(/(\d[\d\s.]*)\s*(produits|references|articles en stock|fiches produits)/g)].some((match) => Number(match[1].replace(/[\s.]/g, "")) > 100);
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

/** Mention d'une fiche « CMS imposé » (À voir, jamais d'alerte). */
export const CMS_NOTE = "CMS imposé : à vous de juger";

export interface AdClass {
  /** Motif d'exclusion (« Ignorée »), ou `null`. */
  reason: string | null;
  /** Développement web (site, landing, blog, application web, SaaS, MVP). */
  webDev: boolean;
  /** CMS imposé (WordPress, Wix, Shopify…) : « À voir », sans alerte. */
  cms: boolean;
}

/** Classement gratuit d'une annonce : exclue (motif), développement web, CMS imposé. */
export function classifyAd(input: PrefilterInput): AdClass {
  const text = plain(`${input.title}\n${input.description}`);
  const categories = input.categories.map(plain);
  const automation = AUTOMATION_SIGNAL.test(`${text} ${categories.join(" ")}`);
  const webDev = isWebDev(text, categories);
  const unCms = text.replace(NEGATED_CMS, " ");
  const cms = CMS.test(unCms) || categories.some((category) => CMS.test(category));
  const verdict = (reason: string | null): AdClass => ({ reason, webDev: !reason && webDev, cms: !reason && cms });
  const mobile = mobileReason(text, categories);
  if (mobile) return verdict(mobile);
  for (const rule of RULES) {
    if (rule.unlessAutomation && automation) continue;
    if (rule.unlessWebDev && webDev) continue;
    if (rule.text?.test(text) || (rule.category && categories.some((category) => rule.category!.test(category)))) return verdict(rule.reason);
  }
  if (heavyCatalog(text)) return verdict("e-commerce lourd (Magento, catalogue de plus de 100 produits)");
  if (TRAINING.test(text) && ON_SITE.test(text) && !IDF_OR_REMOTE.test(text)) return verdict("formation en présentiel hors Île-de-France");
  if (budgetBelow(input.budgetText)) return verdict("budget inférieur à 150 €");
  return verdict(null);
}

/** Motif d'exclusion, ou `null` si l'annonce passe à l'analyse. */
export function prefilterReason(input: PrefilterInput): string | null {
  return classifyAd(input).reason;
}

/**
 * TITRE SEUL (plateformes #11) : une alerte e-mail Codeur ne donne que le titre.
 * Le pré-filtre ci-dessus, pensé pour un titre ET un texte, laisse passer des titres
 * clairement hors cible (« Videaste », « Gestion réseaux sociaux »…) :
 * ces règles, prudentes, ne s'appliquent qu'aux fiches à titre seul. Dans le doute,
 * la fiche reste « À voir » (Axel colle l'annonce).
 */
const TITLE_ONLY_RULES: { reason: string; pattern: RegExp; unlessWebDev?: boolean }[] = [
  { reason: "titre : vidéo, montage ou photo", pattern: /(videaste|\bvideos?\b|monteur|montage|photograph|tournage)/ },
  // Sans création de site (11/10/2026) : « Site web + base SEO » passe, « Campagne Google Ads » non.
  { reason: "titre : réseaux sociaux, community management ou marketing", pattern: /(reseaux sociaux|instagram|tiktok|facebook|linkedin|community|marketeur|\bmarketing\b|publicite|\bseo\b|referencement|\bads\b|\bsea\b|adwords)/, unlessWebDev: true },
  // Sites vitrines, landing, blogs, refontes : ACCEPTÉS (11/10/2026) ; seul l'e-commerce lourd reste écarté.
  { reason: "titre : e-commerce lourd (Magento)", pattern: /(magento)/ },
  { reason: "titre : application mobile", pattern: /(developpeur mobile|^application mobile|\bios\b|android|flutter|swift|kotlin)/ },
  { reason: "titre : data science", pattern: /(data scien|machine learning engineer|deep learning)/ },
  { reason: "titre : télémarketing ou relance téléphonique humaine", pattern: /(relance telephonique|teleprospect|teleconseil|teleoperat|call center|phoning)/ },
  { reason: "titre : service hors numérique (nettoyage, ménage…)", pattern: /(nettoyage|menage|jardinage|demenagement)/ },
];

/** Motif d'exclusion d'une fiche à titre seul (pré-filtre habituel, puis règles du titre), ou `null`. */
export function titleOnlyReason(title: string, budgetText: string | null = null): string | null {
  const base = prefilterReason({ title, description: "", categories: [], budgetText });
  if (base) return base;
  const text = plain(title).trim();
  const webDev = isWebDev(text);
  return TITLE_ONLY_RULES.find((rule) => !(rule.unlessWebDev && webDev) && rule.pattern.test(text))?.reason ?? null;
}
