/**
 * Thème sombre/clair. Le module reste "serveur-compatible" : le script
 * d'initialisation est injecté par le layout racine (Server Component).
 */
export const THEME_STORAGE_KEY = "prospect-theme";

/**
 * Exécuté avant le premier rendu pour appliquer le thème mémorisé sur <html>
 * et éviter tout flash de couleurs. Le sombre est le défaut.
 */
export const themeInitScript = `
try {
  var t = localStorage.getItem('${THEME_STORAGE_KEY}') === 'light' ? 'light' : 'dark';
  document.documentElement.classList.add(t);
} catch (e) { document.documentElement.classList.add('dark'); }
`;
