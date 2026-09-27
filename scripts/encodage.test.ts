/**
 * Encodage des pages et tri signal / fait « site ».
 *
 * Deux régressions vues en prod, verrouillées ici avec les cas EXACTS :
 *   - « FondÃ », « PyrÃ©nÃ©es », « Bordeauxâ€¯? » : de l'UTF-8 relu en Latin-1 ;
 *   - une page « Qui sommes-nous » affichée comme « Signal web ».
 *
 * Aucun appel réseau : les réponses HTTP sont des fixtures en octets.
 * Exécution : `npm run test:encodage`.
 */
import {
  charsetFromContentType,
  charsetFromMeta,
  decodeBody,
  hasMojibake,
  repairMojibake,
  repairValue,
} from "../lib/enrichment/charset";
import { cleanText, excerpt } from "../lib/enrichment/clean";
import { genericPageKind, isDatableEvent, separateSiteFacts } from "../lib/enrichment/site-facts";
import { qualifyWebResults } from "../lib/enrichment/signals";
import type { ProspectSignal } from "../types";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.log(`  ÉCHEC ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

/** Simule la faute d'origine : octets UTF-8 relus en Windows-1252. */
function garble(text: string): string {
  return new TextDecoder("windows-1252").decode(new TextEncoder().encode(text));
}

// ---------------------------------------------------------------------------
console.log("\nRéparation du mojibake — cas exacts de prod");
// ---------------------------------------------------------------------------
{
  check("PyrÃ©nÃ©es → Pyrénées", repairMojibake("PyrÃ©nÃ©es") === "Pyrénées", repairMojibake("PyrÃ©nÃ©es"));
  check("FondÃ©e → Fondée", repairMojibake("FondÃ©e en 1969") === "Fondée en 1969");
  const bordeaux = repairMojibake("Bordeauxâ€¯?");
  check("Bordeauxâ€¯? → espace fine insécable", bordeaux === "Bordeaux\u202F?", bordeaux);
  check("â€™ → apostrophe typographique", repairMojibake("lâ€™entreprise") === "l’entreprise");
  check("Ã + insécable → à", repairMojibake("installée Ã\u00A0 Pau") === "installée à Pau");
  check("Ã¨ → è, Ã§ → ç", repairMojibake("siÃ¨ge franÃ§ais") === "siège français");
  check("â€œ â€ → guillemets", repairMojibake("â€œQualitéâ€\u009D") === "“Qualité”", repairMojibake("â€œQualitéâ€\u009D"));
  check("Å“ → œ", repairMojibake("cÅ“ur de mÃ©tier") === "cœur de métier");
  check("double encodage réparé", repairMojibake(garble(garble("Pyrénées"))) === "Pyrénées", repairMojibake(garble(garble("Pyrénées"))));

  // « FondÃ » : le « © » a été retiré avant nous (pictogramme), l'octet est perdu.
  check("FondÃ orphelin → Fondé", repairMojibake("FondÃ en 1969") === "Fondé en 1969", repairMojibake("FondÃ en 1969"));
  check("FondÃ en fin de texte → Fondé", repairMojibake("Société FondÃ") === "Société Fondé");
  check("Ã isolé → à", repairMojibake("basée Ã Bordeaux") === "basée à Bordeaux", repairMojibake("basée Ã Bordeaux"));
  check("FondÃ e (octet remplacé par une espace) → Fondée", repairMojibake("FondÃ e en 1969") === "Fondée en 1969", repairMojibake("FondÃ e en 1969"));

  for (const sample of [
    "Pyrénées-Atlantiques, Bordeaux ?",
    "CHÂTEAU DE LA GARDE — « déjà » à Pau",
    "Société fondée en 1969 ; l’équipe œuvre à 100 %",
    "prix : 12 € — São Paulo, naïve, ÉTÉ",
  ]) {
    check(`texte sain inchangé : ${sample}`, repairMojibake(sample) === sample, repairMojibake(sample));
  }
  const once = repairMojibake("PyrÃ©nÃ©es, FondÃ en 1969, Bordeauxâ€¯?");
  check("idempotent", repairMojibake(once) === once, once);
  check("détection", hasMojibake("PyrÃ©nÃ©es") && !hasMojibake("Pyrénées"));
}

// ---------------------------------------------------------------------------
console.log("\nNettoyage : la réparation passe AVANT le retrait des pictogrammes");
// ---------------------------------------------------------------------------
{
  // Avant correctif : « © » (2e octet de « é ») était retiré comme pictogramme.
  const text = cleanText("Entreprise FondÃ©e en 1969 dans les PyrÃ©nÃ©es, prÃ¨s de Bordeaux.");
  check("cleanText répare avant de nettoyer", text === "Entreprise Fondée en 1969 dans les Pyrénées, près de Bordeaux.", text);
  check("excerpt aussi", excerpt("Une Ã©quipe basÃ©e Ã\u00A0 Bordeaux depuis 20 ans.").startsWith("Une équipe basée à Bordeaux"));
}

// ---------------------------------------------------------------------------
console.log("\nDécodage HTTP : en-tête, puis <meta>, puis UTF-8");
// ---------------------------------------------------------------------------
{
  const latin1 = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
  const utf8 = (text: string) => new TextEncoder().encode(text);

  check("charset de l'en-tête", charsetFromContentType("text/html; charset=ISO-8859-1") === "iso-8859-1");
  check("charset du meta", charsetFromMeta('<meta charset="windows-1252">') === "windows-1252");
  check(
    "charset du meta http-equiv",
    charsetFromMeta('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">') === "iso-8859-1",
  );

  const page = "<p>Fondée dans les Pyrénées</p>";
  check("en-tête Latin-1 respecté", decodeBody(latin1(page), "text/html; charset=ISO-8859-1") === page, decodeBody(latin1(page), "text/html; charset=ISO-8859-1"));
  const withMeta = `<html><head><meta charset="iso-8859-1"></head><body>${page}</body></html>`;
  check("meta Latin-1 respecté sans en-tête", decodeBody(latin1(withMeta), "text/html") === withMeta);
  check("UTF-8 par défaut", decodeBody(utf8(page), "text/html") === page);
  check("BOM UTF-8 retiré", decodeBody(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(page)]), null) === page);
  check("UTF-8 annoncé mais invalide → Windows-1252", decodeBody(latin1(page), "text/html; charset=utf-8") === page);
  check("charset inconnu → UTF-8", decodeBody(utf8(page), "text/html; charset=x-inconnu") === page);
  // La page est en UTF-8 mais le CMS l'a déjà servie abîmée.
  check("mojibake de la source réparé", decodeBody(utf8(garble(page)), "text/html; charset=utf-8") === page);
}

// ---------------------------------------------------------------------------
console.log("\nScript de réparation : valeurs JSON imbriquées");
// ---------------------------------------------------------------------------
{
  const stored = {
    signals: [{ label: "Signal web", quote: "FondÃ©e dans les PyrÃ©nÃ©es", confidence: 0.9 }],
    key_figures: { site_offer: "Bordeauxâ€¯? lâ€™Ã©quipe", headcount: 12, site_vocabulary: ["mÃ©tier"] },
  };
  const first = repairValue(stored);
  check("répare les chaînes imbriquées", first.changed === 3, first.changed);
  const fixed = first.value as typeof stored;
  check("signal réparé", fixed.signals[0].quote === "Fondée dans les Pyrénées");
  check("tableau réparé", fixed.key_figures.site_vocabulary[0] === "métier");
  check("nombres intacts", fixed.key_figures.headcount === 12 && fixed.signals[0].confidence === 0.9);
  const second = repairValue(fixed);
  check("idempotent : seconde passe sans changement", second.changed === 0, second.changed);
}

// ---------------------------------------------------------------------------
console.log("\nPages génériques : fait « site », pas signal");
// ---------------------------------------------------------------------------
{
  check("/a-propos", genericPageKind("https://acme.fr/a-propos") === "presentation");
  check("/qui-sommes-nous/", genericPageKind("https://acme.fr/qui-sommes-nous/") === "presentation");
  check("/notre-histoire.html", genericPageKind("https://acme.fr/fr/notre-histoire.html") === "presentation");
  check("/recrutement", genericPageKind("https://acme.fr/recrutement") === "recrutement");
  check("titre « Qui sommes-nous ? »", genericPageKind("https://acme.fr/page-12", "Qui sommes-nous ? - ACME") === "presentation");
  check("titre « ACME | À propos »", genericPageKind("https://acme.fr/p", "ACME | À propos") === "presentation");
  check("offre précise : pas générique", genericPageKind("https://acme.fr/recrutement/automaticien-h-f") === null);
  check("article : pas générique", genericPageKind("https://presse.fr/2026/09/acme-ouvre-une-usine") === null);

  const web = (url: string, quote: string, extra: Partial<ProspectSignal> = {}): ProspectSignal => ({
    type: "presse",
    label: "Actualité",
    url,
    quote,
    confidence: 0.85,
    ...extra,
  });

  const about = web("https://acme.fr/qui-sommes-nous", "Fondée en 1969, ACME est une entreprise familiale spécialiste du froid.");
  const history = web("https://acme.fr/notre-histoire", "Notre histoire commence en 1969 avec deux associés à Tarbes.", { type: "croissance" });
  const careers = web("https://acme.fr/recrutement", "Rejoignez une équipe passionnée : ACME recrute toute l'année des talents.", { type: "recrutement" });
  const aboutPage = web("https://acme.fr/a-propos", "Le service client ACME répond à vos questions du lundi au vendredi.", { type: "support" });
  const founded = web("https://presse.fr/acme", "ACME, créée en 1987 à Pau, emploie 40 personnes.");

  const opening = web("https://acme.fr/a-propos", "ACME ouvre une nouvelle agence à Bordeaux en octobre 2026.", { type: "croissance" });
  const leader = web("https://presse.fr/acme-dg", "Marie Durand est nommée directrice générale d'ACME.");
  const raise = web("https://presse.fr/acme-levee", "ACME annonce une levée de fonds de 3 millions d'euros.", { type: "levee" });
  const job = web("https://acme.fr/recrutement/automaticien", "ACME recrute un automaticien H/F en CDI à Tarbes.", {
    type: "recrutement",
    jobTitle: "Automaticien H/F",
  });
  const client = web("https://presse.fr/acme-contrat", "ACME remporte le contrat de maintenance du CHU de Pau.");
  const product = web("https://acme.fr/actualites/gamme", "ACME lance une nouvelle gamme de chambres froides connectées.");
  const structural: ProspectSignal = { type: "structure", label: "Effectif d'au moins 50 personnes", confidence: 0.5 };
  const ecommerce = web("https://presse.fr/acme-boutique", "ACME vend désormais ses pièces détachées en boutique en ligne.", { type: "ecommerce" });

  check("événements détectés", [opening, leader, raise, job, client, product].every((signal) => isDatableEvent(signal)));
  check("présentations non datables", ![about, history, careers, aboutPage, founded].some((signal) => isDatableEvent(signal)));
  check("« ouvert du lundi au vendredi » n'est pas une ouverture", !isDatableEvent(web("https://a.fr", "Magasin ouvert du lundi au vendredi, horaires d'ouverture sur place.")));
  check("« lancée en 1987 » n'est pas un lancement", !isDatableEvent(web("https://a.fr", "La marque, lancée en 1987, reste familiale.")));

  const all = [about, history, careers, aboutPage, founded, opening, leader, raise, job, client, product, structural, ecommerce];
  const { signals, siteFacts } = separateSiteFacts(all);
  const kept = new Set(signals);

  check("« Qui sommes-nous » → fait site", !kept.has(about) && siteFacts.some((fact) => fact.url === about.url && fact.page === "presentation"));
  check("« Notre histoire » → fait site", !kept.has(history));
  check("« Recrutement » générique → fait site", !kept.has(careers) && siteFacts.some((fact) => fact.page === "recrutement"));
  check("« À propos » avec service client → fait site", !kept.has(aboutPage));
  check("« créée en 1987 » sur un article → fait site", !kept.has(founded));
  check("ouverture annoncée, même sur « À propos » → signal", kept.has(opening));
  check("nomination → signal", kept.has(leader));
  check("levée → signal", kept.has(raise));
  check("offre précise → signal", kept.has(job));
  check("nouveau client → signal", kept.has(client));
  check("nouvelle offre → signal", kept.has(product));
  check("signal structurel inchangé", kept.has(structural));
  check("signal ordinaire hors page institutionnelle inchangé", kept.has(ecommerce));
  check("faits site cités mot pour mot", siteFacts.every((fact) => all.some((signal) => signal.quote === fact.text)));

  const titled = separateSiteFacts(
    [web("https://acme.fr/page-12", "ACME accompagne ses clients avec une équipe de 40 techniciens.", { type: "support" })],
    [{ url: "https://acme.fr/page-12", title: "Qui sommes-nous ? | ACME", snippet: "" }],
  );
  check("page reconnue par son titre", titled.signals.length === 0 && titled.siteFacts.length === 1);

  const guessed = separateSiteFacts([
    web("https://acme.fr/carrieres", "Nous recrutons régulièrement des profils techniques passionnés.", {
      type: "recrutement",
      jobTitle: "régulièrement des profils techniques passionnés",
    }),
  ]);
  check("intitulé deviné sur une page carrière générique → fait site", guessed.signals.length === 0, guessed.signals);
  const listed = separateSiteFacts([
    web("https://acme.fr/carrieres", "Automaticien H/F — CDI à Tarbes, poste à pourvoir immédiatement.", {
      type: "recrutement",
      jobTitle: "Automaticien H/F",
      category: "automation",
      structured: true,
    }),
  ]);
  check("offre extraite et citée sur la page carrière → signal", listed.signals.length === 1);

  const twice = separateSiteFacts([about, { ...about, url: "https://acme.fr/a-propos" }]);
  check("même phrase lue deux fois : un seul fait", twice.siteFacts.length === 1);
}

// ---------------------------------------------------------------------------
console.log("\nChaîne de qualification + tri : le cas prod");
// ---------------------------------------------------------------------------
{
  const target = { name: "ACME FROID", website: "https://acme-froid.fr" };
  const qualified = qualifyWebResults(
    [
      {
        title: "Recrutement - ACME FROID",
        url: "https://acme-froid.fr/recrutement",
        snippet: "Rejoignez ACME FROID ! Nous recrutons régulièrement des profils techniques passionnés, envoyez votre candidature.",
      },
      {
        title: "ACME FROID ouvre une agence à Bordeaux",
        url: "https://presse.fr/2026/09/acme-froid-bordeaux",
        snippet: "ACME FROID ouvre une nouvelle agence à Bordeaux le 12 septembre 2026, avec dix embauches prévues.",
        date: "2026-09-12",
      },
    ],
    target,
  );
  const { signals, siteFacts } = separateSiteFacts(qualified);
  check("la qualification seule retenait la page Recrutement", qualified.some((signal) => signal.url?.endsWith("/recrutement")), qualified.map((signal) => signal.url));
  check("après tri : page Recrutement = fait site", !signals.some((signal) => signal.url?.endsWith("/recrutement")) && siteFacts.length === 1);
  check("après tri : l'ouverture reste un signal", signals.some((signal) => signal.url?.includes("bordeaux")));
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
