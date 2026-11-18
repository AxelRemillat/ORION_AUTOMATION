/**
 * Test RLS du CRM (Cowork #117) : applique la VRAIE migration `crm_` dans un Postgres en mémoire (PGlite, Postgres
 * compilé en WebAssembly : aucun serveur, aucune base distante) et vérifie qu'Axel seul lit et écrit ses fiches
 * (assertions dans scripts/crm-rls.sql).
 *
 * Exécution : `PGLITE_MODULE=<chemin>/node_modules/@electric-sql/pglite npm run test:crm-rls`
 * (ou `@electric-sql/pglite` installé dans le projet). Sans PGlite, le test est SAUTÉ : la CI n'en a pas, et on
 * n'ajoute pas de dépendance au projet pour un test local.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type PGlite = { exec: (sql: string) => Promise<unknown>; query: <T>(sql: string) => Promise<{ rows: T[] }>; close: () => Promise<void> };

function chargerPglite(): (new () => PGlite) | null {
  for (const nom of [process.env.PGLITE_MODULE, "@electric-sql/pglite"].filter(Boolean) as string[]) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return (require(nom) as { PGlite: new () => PGlite }).PGlite;
    } catch {
      /* module suivant */
    }
  }
  return null;
}

/** Remplace `\ir fichier` par son contenu et retire les autres méta-commandes psql. */
function aplatir(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .split(/\r?\n/)
    .map((ligne) => {
      const m = ligne.match(/^\\ir\s+(.+)$/);
      if (m) return aplatir(resolve(dirname(chemin), m[1].trim()));
      return ligne.startsWith("\\") ? "" : ligne;
    })
    .join("\n");
}

async function main() {
  const PGlite = chargerPglite();
  if (!PGlite) {
    console.log("crm-rls : SAUTÉ (PGlite absent — PGLITE_MODULE=<chemin vers @electric-sql/pglite>)");
    return;
  }
  const sql = aplatir(join(__dirname, "..", "..", "scripts", "crm-rls.sql"));
  const db = new PGlite();
  try {
    await db.exec(sql);
    const { rows } = await db.query<{ resultat: string }>("select 'CRM RLS OK' as resultat");
    if (rows[0]?.resultat !== "CRM RLS OK") throw new Error("résultat inattendu");
    console.log("  ok   RLS du CRM : Axel seul lit et écrit ; B ne voit, ne modifie ni ne rattache rien ; anon refusé");
    console.log("  ok   pas de DELETE accordé (on masque, on n'efface pas) ; migration rejouable (idempotente)");
    console.log("  ok   étape hors liste refusée par la contrainte");
  } catch (error) {
    console.error("crm-rls : ÉCHEC — " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

void main();
