/**
 * Garde-fou des migrations Supabase, lancé par la CI AVANT tout `db push`.
 *
 * Les migrations partent en production au merge, sans relecture humaine du
 * SQL. Ce script refuse donc ce qui détruit des données ou élargit des droits
 * hors du schéma `public` :
 *   - DROP TABLE, DROP COLUMN, TRUNCATE ;
 *   - DELETE sans WHERE ;
 *   - GRANT / REVOKE sur un schéma autre que `public`.
 *
 * Exception assumée : un commentaire `-- allow-destructive: <raison>` en TÊTE
 * du fichier (avant la première instruction). La raison est obligatoire.
 *
 * Exécution : `npm run check:migrations` (code de sortie 1 si refus).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Violation {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

const NOT_COLUMN = new Set(["constraint", "default", "not", "identity", "expression"]);

const ALLOW = /^\s*--\s*allow-destructive\s*:\s*\S.{2,}/i;

/** `true` si l'en-tête du fichier (commentaires initiaux) autorise l'exception. */
export function allowsDestructive(sql: string): boolean {
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("--")) return false;
    if (ALLOW.test(trimmed)) return true;
  }
  return false;
}

/**
 * Remplace commentaires et chaînes par des espaces, en conservant les sauts
 * de ligne : les numéros de ligne restent justes, et un « drop table » écrit
 * dans un commentaire ou une chaîne ne déclenche rien.
 */
export function stripNonCode(sql: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/--[^\n]*/g, blank)
    .replace(/'(?:[^']|'')*'/g, blank);
}

interface Statement {
  text: string;
  line: number;
}

function statements(code: string): Statement[] {
  const result: Statement[] = [];
  let offset = 0;
  for (const chunk of code.split(";")) {
    const lead = chunk.length - chunk.trimStart().length;
    const text = chunk.trim().replace(/\s+/g, " ");
    if (text) result.push({ text, line: code.slice(0, offset + lead).split("\n").length });
    offset += chunk.length + 1;
  }
  return result;
}

/** Schémas visés par un GRANT/REVOKE ; un nom non qualifié vaut `public`. */
function grantSchemas(text: string): string[] {
  const schemas: string[] = [];
  for (const match of text.matchAll(/\b(?:in\s+schema|on\s+schema)\s+("?[\w]+"?(?:\s*,\s*"?[\w]+"?)*)/gi)) {
    schemas.push(...match[1].split(",").map((name) => name.trim().replace(/"/g, "")));
  }
  const target = text.match(/\bon\s+(?:table\s+|sequence\s+|function\s+|all\s+\w+\s+in\s+schema\s+)?("?\w+"?)\.("?\w+"?)/i);
  if (target) schemas.push(target[1].replace(/"/g, ""));
  return schemas.map((name) => name.toLowerCase());
}

export function checkMigration(file: string, sql: string): Violation[] {
  if (allowsDestructive(sql)) return [];
  const violations: Violation[] = [];
  const flag = (statement: Statement, rule: string) =>
    violations.push({ file, line: statement.line, rule, excerpt: statement.text.slice(0, 120) });

  for (const statement of statements(stripNonCode(sql))) {
    const text = statement.text.toLowerCase();
    if (/^drop\s+table\b/.test(text)) flag(statement, "DROP TABLE");
    if (/^alter\s+table\b/.test(text)) {
      // ALTER TABLE t DROP [COLUMN] [IF EXISTS] c. « drop constraint »,
      // « drop default », « drop not null »… ne perdent aucune donnée.
      for (const match of text.matchAll(/\bdrop\s+(column\s+)?(?:if\s+exists\s+)?"?(\w+)/g)) {
        if (match[1] || !NOT_COLUMN.has(match[2])) {
          flag(statement, "DROP COLUMN");
          break;
        }
      }
    }
    if (/^truncate\b/.test(text)) flag(statement, "TRUNCATE");
    // DELETE en tête d'instruction uniquement : « grant ... delete on » et
    // « on delete cascade » ne suppriment rien.
    if (/^(?:with\b.*\)\s*)?delete\s+from\b/.test(text) && !/\bwhere\b/.test(text)) {
      flag(statement, "DELETE sans WHERE");
    }
    if (/^(?:grant|revoke)\b/.test(text)) {
      const outside = grantSchemas(text).filter((schema) => schema !== "public");
      if (outside.length) flag(statement, `GRANT/REVOKE hors du schéma public (${[...new Set(outside)].join(", ")})`);
    }
  }
  return violations;
}

export function checkDirectory(directory: string): Violation[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) => checkMigration(name, readFileSync(join(directory, name), "utf8")));
}

if (require.main === module) {
  const directory = process.argv[2] ?? join(process.cwd(), "supabase", "migrations");
  const violations = checkDirectory(directory);
  if (!violations.length) {
    console.log(`Migrations vérifiées : aucune opération destructive (${directory}).`);
    process.exit(0);
  }
  for (const item of violations) {
    // Format d'annotation GitHub : l'erreur s'affiche sur la ligne du fichier.
    console.log(`::error file=supabase/migrations/${item.file},line=${item.line}::${item.rule} — ${item.excerpt}`);
  }
  console.log(
    `\n${violations.length} opération(s) refusée(s). Si c'est voulu, ajoutez en tête du fichier :\n` +
      "-- allow-destructive: <raison>",
  );
  process.exit(1);
}
