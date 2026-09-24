/**
 * Sonde d'extraction — à quoi ressemble vraiment ce que le pipeline lit.
 *
 * Affiche, pour une entreprise : les pages retenues, leur texte nettoyé, puis
 * le résultat brut de l'extraction structurée AVEC les éléments rejetés et la
 * raison du rejet. C'est l'outil de diagnostic quand un signal attendu
 * n'apparaît pas : il dit si le modèle n'a rien trouvé, ou si la vérification
 * de citation l'a écarté.
 *
 *   npx tsx scripts/extract-probe.ts "BLUE ENERFREEZE" --siren 844104851 --domain blue-enerfreeze.com
 */
import { existsSync, readFileSync } from "node:fs";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnv();

const arg = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
};

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) throw new Error('usage : npx tsx scripts/extract-probe.ts "NOM" --domain exemple.fr');

  const { coverSite } = await import("../lib/enrichment/site");
  const { extractSignals } = await import("../lib/enrichment/extract");

  const identity = {
    name,
    siren: arg("siren"),
    city: arg("city"),
    postalCode: arg("cp"),
  };

  const site = await coverSite({
    ...identity,
    knownWebsite: arg("domain"),
  });

  console.log(`\n=== SITE : ${site.status} (${site.discoveredBy ?? "aucune source"})`);
  if (site.note) console.log(`note : ${site.note}`);
  for (const page of site.pages) {
    console.log(`\n--- ${page.url}  [${page.via}]  ${page.text.length} caracteres`);
    console.log(page.text.slice(0, 700));
  }

  if (!site.pages.length) return;

  const extraction = await extractSignals(
    { ...identity, website: site.url },
    site.pages.map((page) => ({ url: page.url, title: name, content: page.text, sourceDate: null })),
  );

  console.log("\n=== EXTRACTION");
  console.log(JSON.stringify(extraction, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
