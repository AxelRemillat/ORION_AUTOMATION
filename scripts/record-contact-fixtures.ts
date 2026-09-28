/**
 * Enregistre les VRAIES réponses du web pour les fixtures du module contact.
 *
 *   npx tsx scripts/record-contact-fixtures.ts            # les trois cas
 *   npx tsx scripts/record-contact-fixtures.ts 421882440  # un seul
 *
 * Pourquoi : les fixtures étaient reconstituées à la main — quelques centaines
 * d'octets de HTML propre. Elles validaient donc un module qui ne marchait pas
 * sur le vrai web, et trois défauts sont passés à travers :
 *
 *   - sur un site Wix, le contenu utile est à l'octet 509 638 ; la lecture était
 *     coupée à 400 000 ;
 *   - le lien des mentions légales est « /mentions-légales », accentué, donc
 *     percent-encodé et méconnaissable par le motif de reconnaissance ;
 *   - la page de mentions légales cite l'hébergeur (`support@ovh.com`), d'où une
 *     recherche Hunter sur ovh.com et une proposition d'écrire à un salarié
 *     d'OVH.
 *
 * Les pages sont stockées GZIPPÉES : ce sont les octets réels (1 Mo de HTML Wix
 * pour une seule page d'accueil), et le dépôt reste lisible. Les résultats de
 * recherche Linkup sont enregistrés à côté, en JSON, pour que le test rejoue les
 * vrais classements — c'est sur eux que portent le tri et les exclusions.
 *
 * CONSOMME des recherches Linkup (une par requête enregistrée).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const FIX = "scripts/fixtures/contact-finder";

/** Les trois cas, avec le nom de dossier et les pages à lire. */
const CASES = [
  {
    siren: "421882440",
    dir: "briol",
    pages: [
      "https://menuiseriebriol-diffusion.com",
      "https://www.menuiseriebriol-diffusion.com/mentions-l%C3%A9gales",
      "https://www.menuiseriebriol-diffusion.com/%C3%A0-propos",
    ],
  },
  {
    siren: "520644386",
    dir: "artflex",
    pages: [
      "https://robinetterieindustrielle.fr",
      "https://robinetterieindustrielle.fr/mentions-legales.html",
      // L'homonyme : un éditeur de logiciels dont la page légale écrit « ARTFLEX ».
      "https://www.artflex.software/en/terms/legal-notice",
    ],
  },
  {
    siren: "349925735",
    dir: "bonnin",
    pages: [
      "https://boulangerie-bonnin.fr",
      "https://boulangerie-bonnin.fr/mentions-legales/",
      "https://boulangerie-bonnin.fr/contact/",
    ],
  },
];

/** Nom de fichier lisible et stable, dérivé de l'URL. */
function fileNameOf(url: string): string {
  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname).replace(/\/$/, "");
  const slug = (path || "/index").replace(/^\//, "").replace(/[^A-Za-z0-9._-]+/g, "-") || "index";
  return `${slug.replace(/\.html?$/, "")}.html.gz`;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((arg) => /^\d{9}$/.test(arg));
  const { realDeps } = await import("../lib/contact-finder/clients");
  const { identityOf } = await import("../lib/contact-finder/sources");
  const { searchQueries } = await import("../lib/contact-finder/finder");
  const deps = realDeps(null);

  for (const item of CASES) {
    if (only.length && !only.includes(item.siren)) continue;
    const dir = `${FIX}/${item.dir}`;
    mkdirSync(dir, { recursive: true });
    console.log(`\n=== ${item.dir} (SIREN ${item.siren})`);

    // Identité réelle : c'est elle qui produit les requêtes à enregistrer.
    const base = {
      id: "record", company_name: item.siren, siren: item.siren,
      website: null, email: null, city: null, key_figures: {},
    } as never;
    const company = await identityOf(base);
    const queries = searchQueries(company);

    const searches: { query: string; results: { url: string; title: string; snippet: string }[] }[] = [];
    for (const query of queries) {
      const results = (await deps.webSearch(query)) ?? [];
      searches.push({ query, results });
      console.log(`  recherche « ${query} » : ${results.length} résultat(s)`);
    }
    writeFileSync(
      `${dir}/search.json`,
      `${JSON.stringify({ recordedAt: new Date().toISOString().slice(0, 10), identity: company, searches }, null, 2)}\n`,
      "utf8",
    );

    for (const url of item.pages) {
      const page = await deps.fetchHtml(url);
      if (!page) {
        console.log(`  ${url} → INJOIGNABLE, non enregistré`);
        continue;
      }
      const name = fileNameOf(url);
      writeFileSync(`${dir}/${name}`, gzipSync(Buffer.from(page.html, "utf8")));
      console.log(`  ${url} → ${name} (${page.html.length} caractères)`);
    }
  }
  console.log("\nFixtures enregistrées.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
