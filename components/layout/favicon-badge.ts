import { faviconLabel } from "@/lib/badges/tab";

/**
 * Pastille rouge sur le favicon (Cowork #28), dessinée en canvas à partir du
 * favicon actuel — aucune dépendance. L'adresse d'origine de chaque <link
 * rel="icon"> est gardée dans `data-orion-href` : N = 0 la remet telle quelle.
 */
const SIZE = 64;

function iconLinks(): HTMLLinkElement[] {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']"));
  if (links.length) return links;
  const link = document.createElement("link");
  link.rel = "icon";
  link.href = "/favicon.ico";
  document.head.appendChild(link);
  return [link];
}

function originalHref(link: HTMLLinkElement): string {
  if (!link.dataset.orionHref) link.dataset.orionHref = link.href;
  return link.dataset.orionHref;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** L'encre « perdu / erreur » du design system (lisible sous du blanc) ; à défaut, le rouge du navigateur. */
const badgeColor = () => {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue("--rgb-lost-ink").trim();
  return rgb ? `rgb(${rgb.split(/\s+/).join(",")})` : "red";
};

export async function paintFaviconBadge(count: number): Promise<void> {
  const links = iconLinks();
  const source = originalHref(links[0]);
  if (count <= 0) {
    for (const link of links) link.href = originalHref(link);
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return;
  const image = await loadImage(source);
  if (image) context.drawImage(image, 0, 0, SIZE, SIZE);

  const label = faviconLabel(count);
  const radius = label.length > 1 ? 24 : 20;
  const x = SIZE - radius;
  const y = radius;
  context.beginPath();
  context.arc(x, y, radius, 0, 2 * Math.PI);
  context.fillStyle = badgeColor();
  context.fill();
  context.fillStyle = "white";
  context.font = `bold ${label.length > 2 ? 22 : 30}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x, y + 2);

  const href = canvas.toDataURL("image/png");
  for (const link of links) {
    originalHref(link);
    link.href = href;
  }
}
