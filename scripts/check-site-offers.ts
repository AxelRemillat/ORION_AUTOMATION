/**
 * La copie des offres (lib/offer/site-offers.ts) est-elle encore celle du site ?
 *
 *   npm run check:site-offers
 *
 * Lit la page publique https://axelremillat.com/offres et vérifie que chaque
 * intitulé et chaque prix « à partir de » de la copie y figure. Réseau requis :
 * hors de `npm test` et de la CI, pour qu'un site momentanément injoignable ne
 * bloque aucun merge. Aucune clé, aucune écriture.
 */
import { SITE_OFFERS, SITE_OFFERS_SOURCE, SITE_OFFERS_URL } from "../lib/offer/site-offers";

/** Espaces insécables et entités ramenés à un espace simple : le HTML n'écrit pas « 1 200 € » comme le code. */
const flatten = (text: string) =>
  text
    .replace(/&nbsp;|&#160;|&#x202f;|&#8239;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ");

async function main(): Promise<void> {
  const response = await fetch(SITE_OFFERS_URL);
  if (!response.ok) throw new Error(`${SITE_OFFERS_URL} : HTTP ${response.status}`);
  const page = flatten(await response.text());

  const missing: string[] = [];
  for (const offer of SITE_OFFERS) {
    for (const text of [offer.name, offer.price]) {
      if (!page.includes(flatten(text))) missing.push(`« ${text} » (${offer.name})`);
    }
  }
  if (missing.length) {
    console.error(`Écart avec le site (${SITE_OFFERS_URL}) :\n  ${missing.join("\n  ")}`);
    console.error(`Mettre lib/offer/site-offers.ts à jour depuis ${SITE_OFFERS_SOURCE}.`);
    process.exit(1);
  }
  console.log(`Offres alignées sur le site : ${SITE_OFFERS.length} intitulés et prix retrouvés sur ${SITE_OFFERS_URL}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
