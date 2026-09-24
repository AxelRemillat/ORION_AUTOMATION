/**
 * Tests du garde-fou des migrations (scripts/check-migrations.ts).
 * Exécution : `npm run test:migrations`.
 */
import { join } from "node:path";
import { allowsDestructive, checkDirectory, checkMigration } from "./check-migrations";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const rules = (sql: string) => checkMigration("x.sql", sql).map((item) => item.rule);

console.log("\n1. Refusé");
check("DROP TABLE", rules("drop table public.deals;").includes("DROP TABLE"));
check("DROP TABLE IF EXISTS", rules("DROP TABLE IF EXISTS public.deals;").includes("DROP TABLE"));
check("DROP COLUMN", rules("alter table public.prospects drop column email;").includes("DROP COLUMN"));
check("DROP sans le mot COLUMN", rules("alter table public.prospects drop if exists email;").includes("DROP COLUMN"));
check("TRUNCATE", rules("truncate public.messages;").includes("TRUNCATE"));
check("DELETE sans WHERE", rules("delete from public.messages;").includes("DELETE sans WHERE"));
check("GRANT sur auth", rules("grant select on auth.users to anon;").some((rule) => rule.startsWith("GRANT")));
check("GRANT ON SCHEMA storage", rules("grant usage on schema storage to anon;").some((rule) => rule.startsWith("GRANT")));
check("REVOKE ALL IN SCHEMA extensions", rules("revoke all on all tables in schema extensions from public;").length === 1);
const located = checkMigration("x.sql", "-- entete\ncreate table t (id int);\n\ndrop table t;");
check("numéro de ligne exact", located[0]?.line === 4, String(located[0]?.line));

console.log("\n2. Accepté");
check("DELETE avec WHERE", rules("delete from public.messages where id = 1;").length === 0);
check("GRANT … DELETE ON public", rules("grant select, insert, update, delete on public.prospects to authenticated;").length === 0);
check("ON DELETE CASCADE", rules("create table t (p uuid references public.prospects (id) on delete cascade);").length === 0);
check("GRANT non qualifié = public", rules("grant select on prospects to authenticated;").length === 0);
check("DROP POLICY IF EXISTS", rules('drop policy if exists "owner" on public.t;').length === 0);
check("DROP CONSTRAINT", rules("alter table t drop constraint if exists t_fk;").length === 0);
check("DROP NOT NULL / DEFAULT", rules("alter table t alter column c drop not null, alter column d drop default;").length === 0);
check("mot-clé en commentaire", rules("-- drop table t;\n/* truncate t; */ select 1;").length === 0);
check("mot-clé dans une chaîne", rules("comment on table t is 'drop table t';").length === 0);
check("mot-clé dans une fonction $$", rules("create function f() returns void as $$ delete from t; $$ language sql;").length === 0);

console.log("\n3. Exception en tête de fichier");
check("allow-destructive avec raison", allowsDestructive("-- allow-destructive: purge des doublons validée\ndrop table t;"));
check("raison obligatoire", !allowsDestructive("-- allow-destructive:\ndrop table t;"));
check("exception ignorée hors en-tête", rules("select 1;\n-- allow-destructive: trop tard\ndrop table t;").includes("DROP TABLE"));

console.log("\n4. Migrations du dépôt");
const repo = checkDirectory(join(__dirname, "..", "..", "supabase", "migrations"));
check("toutes les migrations existantes passent", repo.length === 0, JSON.stringify(repo));

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
