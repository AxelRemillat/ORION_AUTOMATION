/**
 * Theme clair / sombre.
 *
 * Le theme vit dans l'attribut `data-theme` sur <html> :
 *   - absent  -> on suit la preference systeme (clair par defaut) ;
 *   - "light" / "dark" -> choix explicite de l'utilisateur, memorise.
 *
 * Une classe `theme-light` / `theme-dark` est posee en parallele. Elle n'a
 * aucun role de style : elle sert de signal aux composants qui observent les
 * mutations de `class` sur <html> pour relire les tokens (cf. les graphes).
 *
 * Module volontairement sans "use client" : le script d'initialisation est
 * injecte par le layout racine, qui est un Server Component.
 */

export const THEME_STORAGE_KEY = "prospect-theme";

export type Theme = "light" | "dark";

/**
 * Execute avant le premier rendu pour eviter tout flash de couleurs.
 * Sans choix memorise, on ne pose rien : la preference systeme s'applique.
 */
export const themeInitScript = `
try {
  var t = localStorage.getItem('${THEME_STORAGE_KEY}');
  if (t === 'light' || t === 'dark') {
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.classList.add('theme-' + t);
  }
} catch (e) {}
`;

/** Theme effectivement affiche, preference systeme comprise. */
export function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applique un theme et le memorise. Le stockage peut echouer : on continue. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(`theme-${theme}`);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Navigation privee ou stockage refuse : le theme reste valable pour la
    // session en cours, on n'echoue pas pour autant.
  }
}
