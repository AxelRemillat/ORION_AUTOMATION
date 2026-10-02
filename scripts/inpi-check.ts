/**
 * Validation RÉELLE du repli INPI sur trois cas connus — à lancer en local une
 * fois `INPI_USERNAME` / `INPI_PASSWORD` posées dans `.env.local`. L'API RNE
 * est gratuite : aucun crédit consommé. N'affiche ni identifiant ni jeton.
 *
 *   npx tsx scripts/inpi-check.ts           # compare au résultat attendu
 *   npx tsx scripts/inpi-check.ts --write   # et remplace les fixtures par la vraie réponse
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchInpiOpposition, readOpposition } from "../lib/enrichment/inpi";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
}

const CASES = [
  { siren: "453450256", name: "SELECTION HABITAT", opposed: true },
  { siren: "898001029", name: "ADJUVOO", opposed: true },
  { siren: "520644386", name: "ARTFLEX", opposed: false },
];

async function main() {
  loadEnv();
  const write = process.argv.includes("--write");
  let failures = 0;
  for (const item of CASES) {
    // Réponse brute capturée au passage, pour --write.
    let raw: unknown = null;
    const capture: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).includes("/companies/") && response.ok) {
        raw = await response.clone().json().catch(() => null);
      }
      return response;
    };
    const read = await fetchInpiOpposition(item.siren, capture);
    if (!read.ok) {
      failures += 1;
      console.log(`  FAIL ${item.name} (${item.siren}) — ${read.error}`);
      continue;
    }
    const ok = read.refuses === item.opposed;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${item.name} (${item.siren}) : ${read.refuses ? "opposée" : "non opposée"} — attendu ${item.opposed ? "opposée" : "non opposée"}`);
    if (raw && readOpposition(raw) === null) console.log("       ⚠ champ diffusionCommerciale introuvable dans la réponse");
    if (write && raw) {
      // Réduite aux champs utiles : la réponse complète porte des données
      // personnelles (représentants) qui n'ont rien à faire dans le dépôt.
      const formality = ((raw as { formality?: Record<string, unknown> }).formality ?? {}) as Record<string, unknown>;
      const reduced = {
        siren: item.siren,
        formality: {
          siren: item.siren,
          typePersonne: formality.typePersonne ?? null,
          diffusionINSEE: formality.diffusionINSEE ?? null,
          diffusionCommerciale: formality.diffusionCommerciale ?? (raw as Record<string, unknown>).diffusionCommerciale ?? null,
        },
      };
      writeFileSync(`scripts/fixtures/inpi/${item.siren}.json`, `${JSON.stringify(reduced, null, 2)}\n`);
    }
  }
  console.log(failures ? `\n${failures} cas en échec.` : "\nLes trois cas sont conformes.");
  process.exit(failures ? 1 : 0);
}

void main();
