/**
 * Nettoyage des textes web AVANT toute exploitation.
 *
 * Les résultats Linkup arrivent en markdown de scraper : liens `[x](url)`,
 * titres `#`, puces, emojis, et surtout des blocs de navigation (« Accueil |
 * Nos services | Contact ») qui n'apprennent rien mais occupent la moitié du
 * contexte envoyé au modèle. Tant que ce nettoyage se faisait au dernier
 * moment — à la construction du prompt — le markdown brut circulait jusqu'à
 * l'UI et jusqu'aux citations stockées en base.
 *
 * Règle : on nettoie à l'ENTRÉE du pipeline. Tout ce qui est stocké, affiché
 * ou envoyé au modèle est déjà propre.
 */

/** Lignes de menu : beaucoup de séparateurs, peu de mots, aucune ponctuation. */
const NAV_SEPARATORS = /[|•·»→>]/g;

/** Mots qui trahissent un bandeau de navigation ou de consentement. */
const NAV_WORDS =
  /^(accueil|menu|navigation|rechercher|connexion|se connecter|mon compte|panier|newsletter|cookies?|accepter|tout accepter|param[ée]trer|mentions l[ée]gales|politique de confidentialit[ée]|plan du site|aller au contenu|skip to content|partager|suivez-nous|nous suivre)\b/i;

/**
 * Retire la syntaxe markdown sans perdre le texte porteur.
 * Les libellés de liens sont conservés : « [Automaticien/ne](/offre/12) »
 * devient « Automaticien/ne », qui est précisément l'information utile.
 */
export function stripMarkdown(raw: string): string {
  return raw
    // Images d'abord : leur alt n'apporte rien et le `!` traînerait.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Liens bruts et balises HTML résiduelles.
    .replace(/<[^>]{1,120}>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    // Titres, emphase, code, citations, tableaux.
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*[-–—•·*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    // Emojis et symboles décoratifs.
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[←-⇿─-╿]/g, " ");
}

/** `true` si la ligne ressemble à un menu plutôt qu'à une phrase. */
export function isNavigationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (NAV_WORDS.test(trimmed)) return true;

  const words = trimmed.split(/\s+/);
  const separators = (trimmed.match(NAV_SEPARATORS) ?? []).length;
  // Trois séparateurs ou plus sur une ligne courte : c'est une barre de liens.
  if (separators >= 3 && words.length < 30) return true;
  // Ligne très courte sans verbe ni ponctuation : libellé d'onglet.
  if (words.length <= 3 && !/[.!?:;]/.test(trimmed) && trimmed.length < 40) return true;
  return false;
}

/**
 * Texte prêt à être lu par un humain ou par le modèle : markdown retiré,
 * navigation écartée, espaces normalisés.
 */
export function cleanText(raw: string, maxLength = 6_000): string {
  const lines = stripMarkdown(raw)
    .split(/\r?\n/)
    .filter((line) => !isNavigationLine(line))
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  const text = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** Forme comparable : minuscules, sans accents, espaces et guillemets unifiés. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘‛`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[ \s]+/g, " ")
    .trim();
}

/**
 * Vérifie qu'une citation provient bien du texte source.
 *
 * La comparaison est normalisée (casse, accents, espaces) mais reste une
 * INCLUSION stricte : un modèle qui reformule, résume ou complète une phrase
 * échoue le test, et l'élément est rejeté. C'est le garde-fou central de
 * l'extraction — sans lui, une « preuve » peut être inventée.
 */
export function quoteIsGrounded(quote: string, source: string): boolean {
  const needle = normalizeForMatch(quote);
  // Sous 15 caractères, une citation ne prouve rien : « recrute » se trouve
  // partout. On exige un fragment de phrase.
  if (needle.length < 15) return false;
  return normalizeForMatch(source).includes(needle);
}

/** Coupe proprement à la fin d'une phrase, pour un affichage court. */
export function excerpt(raw: string, maxLength = 220): string {
  const text = cleanText(raw, maxLength * 4).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 60 ? cut.slice(0, stop + 1) : cut).trim();
}
