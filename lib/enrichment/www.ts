/**
 * DOMAINE NU SANS HTTPS (Cowork #35, 14/10/2026) : planfor.fr, gravir.fr, batiformes.com,
 * asialand.fr… ne répondent pas sur `https://domaine.fr`, mais bien sur `https://www.domaine.fr`.
 * La lecture du site s'arrêtait au domaine nu : 10 fiches sur 31 en « Profil à compléter » et
 * aucun brouillon. On retente UNE fois avec « www. ». Code pur.
 */
const TWO_LEVEL = new Set(["co.uk", "org.uk", "com.au", "co.nz", "com.br", "co.jp"]);

/** `https://planfor.fr/contact` → `https://www.planfor.fr/contact` ; `null` si déjà « www. » ou sous-domaine. */
export function wwwVariant(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const labels = parsed.hostname.toLowerCase().split(".");
  const apexLength = TWO_LEVEL.has(labels.slice(-2).join(".")) ? 3 : 2;
  if (labels[0] === "www" || labels.length !== apexLength) return null;
  parsed.hostname = `www.${parsed.hostname}`;
  return parsed.toString().replace(/\/$/, url.endsWith("/") ? "/" : "");
}
