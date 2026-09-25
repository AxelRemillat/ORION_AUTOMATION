/**
 * Thème courant, lu comme le fait globals.css : `data-theme` explicite, sinon
 * préférence système. Côté client uniquement.
 */
export function isNightTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Appelle `onChange` à chaque bascule de thème ; renvoie le désabonnement. */
export function watchTheme(onChange: (night: boolean) => void): () => void {
  const notify = () => onChange(isNightTheme());
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", notify);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", notify);
  };
}
