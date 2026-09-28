/**
 * Domaines : ce qui peut être un site officiel, et ce qui ne l'est jamais.
 *
 * Une recherche web renvoie d'abord les annuaires : ils mentionnent le SIREN et
 * la raison sociale, et passeraient donc la validation. Il faut les écarter
 * AVANT, par liste — c'est précisément sur eux que la validation se tromperait.
 */

const EXCLUDED = [
  // Annuaires légaux et financiers
  "pappers", "societe.com", "infogreffe", "verif.com", "manageo", "infonet", "annuaire-entreprises",
  "data.gouv", "bodacc", "kompass", "corporama", "entreprises.lefigaro", "score3", "insee",
  "lagazettefrance", "ellisphere", "creditsafe", "dnb.com", "b-reputation", "annuaire",
  // Vus en direct sur BRIOL DIFFUSION et ARTFLEX : republieurs de donnees
  // legales, indiscernables d'un site officiel pour la validation.
  "inpi", "contract-factory", "prodestravaux", "mil.wf", "trabajo", "bilansgratuits", "dirigeant.com",
  "rubypayeur", "firmania", "energierecrute", "altigoo",
  "entreprise.pro", "hoodspot", "yelp", "tripadvisor", "justacote", "118000", "118712", "cylex",
  "pagesjaunes", "pages-jaunes", "mappy", "waze", "google", "bing", "apple.com",
  // Réseaux et petites annonces
  "linkedin", "facebook", "instagram", "twitter", "x.com", "youtube", "tiktok", "pinterest",
  "leboncoin", "viadeo", "indeed", "welcometothejungle", "hellowork", "francetravail", "pole-emploi",
  "wikipedia", "doctolib", "ubereats", "deliveroo", "just-eat",
  // Annuaires sectoriels
  "habitatpresto", "travaux.com", "houzz", "batiweb", "123devis", "quotatis", "artisans-du-batiment",
  "boulangerie.org", "infobel", "europages", "usinenouvelle", "annuaire-mairie",
];

/**
 * Comparaison par LIBELLÉ, pas par sous-chaîne : « dun » ne doit pas écarter
 * dunkerque-menuiserie.fr. Une entrée pointée (« societe.com ») vaut pour le
 * domaine et ses sous-domaines ; une entrée simple (« pappers ») pour tout
 * libellé qui commence par elle (pappers.fr, annuaire-mairie.fr).
 */
export function isExcludedDomain(domain: string): boolean {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  return EXCLUDED.some((entry) =>
    entry.includes(".")
      ? host === entry || host.endsWith(`.${entry}`) || host.startsWith(`${entry}.`) || host.includes(`.${entry}.`)
      : labels.some((label) => label === entry || label.startsWith(`${entry}-`) || (label.startsWith(entry) && entry.length >= 6)),
  );
}

/**
 * PRESTATAIRES TECHNIQUES : hébergeur, registrar, éditeur du site, régie.
 *
 * Toute page de mentions légales cite son hébergeur — c'est une obligation. Sur
 * boulangerie-bonnin.fr, la page porte `support@ovh.com` ; le module en a
 * déduit qu'ovh.com était un domaine d'adresses de l'entreprise, a interrogé
 * Hunter dessus, et a proposé d'écrire à un salarié d'OVH. Vérifié le
 * 28/09/2026.
 *
 * Ces domaines ne sont donc ni un site candidat, ni un domaine d'adresses.
 */
const PROVIDERS = [
  "ovh", "ovhcloud", "ionos", "1and1", "gandi", "o2switch", "hostinger", "godaddy", "namecheap",
  "infomaniak", "lws.fr", "planethoster", "nuxit", "phpnet", "amen.fr", "bluehost", "siteground",
  "wix", "wixsite", "squarespace", "shopify", "wordpress", "jimdo", "weebly", "webflow", "strikingly",
  "cloudflare", "amazonaws", "azurewebsites", "netlify", "vercel", "github", "gitlab",
  "hubspot", "mailchimp", "sendinblue", "brevo", "sellsy", "salesforce", "zendesk", "wengo",
  "sarbacane", "mailjet", "cegid", "orange-business",
];

export function isServiceProvider(domain: string): boolean {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  return PROVIDERS.some((entry) =>
    entry.includes(".") ? host === entry || host.endsWith(`.${entry}`) : labels.some((label) => label === entry),
  );
}

/** Messageries grand public : leur domaine n'est pas celui de l'entreprise. */
const FREE_MAILBOX =
  /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|orange|wanadoo|free|sfr|laposte|bbox|numericable|aol|icloud|me|protonmail|proton|neuf|club-internet)\./i;

export function isFreeMailbox(domain: string): boolean {
  return FREE_MAILBOX.test(domain);
}

/** « https://www.Exemple.fr/contact » → « exemple.fr ». Rend null pour un hôte douteux. */
export function toDomain(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !/\.[a-z]{2,}$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function domainOfEmail(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().split("@")[1];
  if (!at) return null;
  const domain = at.replace(/^www\./, "");
  return isFreeMailbox(domain) ? null : domain;
}
