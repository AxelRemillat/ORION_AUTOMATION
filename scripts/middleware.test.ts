/**
 * Tests du middleware : les routes MACHINE ne sont jamais redirigées.
 *
 * Le bug : `/api/inbound` n'était pas exempté de la redirection de session.
 * Un POST de n8n, qui n'a évidemment pas de cookie, recevait un 307 vers
 * `/login`. Le webhook ne voyait jamais la route, et n8n rejouait l'email.
 *
 * Exécution : `npm run test:middleware`.
 */
import { isMachinePath, isPublicPath } from "../middleware";
import { secretMatches } from "../lib/inbound/secret";
import { authorizeCron } from "../lib/trash/cron-auth";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n1. Routes machine : exemptées de la redirection");
{
  check("/api/inbound est une route machine", isMachinePath("/api/inbound"));
  check("/api/opportunities/ingest (veille Codeur) est une route machine", isMachinePath("/api/opportunities/ingest"));
  check("/api/opportunities/ingest-email (e-mails des plateformes) est une route machine", isMachinePath("/api/opportunities/ingest-email"));
  check("/api/opportunites (saisie, session) n'est PAS une route machine", !isMachinePath("/api/opportunites"));
  check("/api/cron/purge-trash aussi", isMachinePath("/api/cron/purge-trash"));
  check("/api/cron seul aussi", isMachinePath("/api/cron"));
  check("/api/jobs/tick est une route machine (pg_cron, sans cookie)", isMachinePath("/api/jobs/tick"));
  check("/api/jobs reste protégée par la session", !isMachinePath("/api/jobs") && !isMachinePath("/api/jobs/abc/cancel"));

  // Elles ne doivent PAS devenir publiques au sens « session » : la distinction
  // compte, sinon on ouvrirait la porte en croyant l'exempter.
  check("une route machine n'est pas « publique »", !isPublicPath("/api/inbound"));

  check("/login reste public", isPublicPath("/login"));
  check("/auth/callback reste public", isPublicPath("/auth/callback"));

  // Le piège classique du préfixe : une route voisine ne doit pas passer.
  check("/api/prospects reste protégée", !isMachinePath("/api/prospects") && !isPublicPath("/api/prospects"));
  check("/api/inbound-fake ne passe pas", !isMachinePath("/api/inbound-fake"));
  check("/logins ne passe pas", !isPublicPath("/logins"));
  check("/cockpit reste protégée", !isMachinePath("/cockpit") && !isPublicPath("/cockpit"));
}

console.log("\n2. Chaque route machine garde SON secret");
{
  const secret = "un-secret-partage-avec-n8n";

  // 401 : aucun secret fourni.
  check("inbound sans secret : refusé", !secretMatches(null, secret));
  check("inbound secret vide : refusé", !secretMatches("", secret));
  // 401 : mauvais secret, y compris de longueur différente.
  check("inbound mauvais secret : refusé", !secretMatches("mauvais", secret));
  check("inbound secret plus long : refusé", !secretMatches(`${secret}x`, secret));
  // 200 : le bon secret passe.
  check("inbound bon secret : accepté", secretMatches(secret, secret));

  check("cron sans en-tête : refusé", !authorizeCron(null, secret));
  check("cron mauvais schéma : refusé", !authorizeCron(secret, secret));
  check("cron mauvais secret : refusé", !authorizeCron("Bearer autre", secret));
  check("cron sans secret configuré : refusé", !authorizeCron(`Bearer ${secret}`, undefined));
  check("cron bon secret : accepté", authorizeCron(`Bearer ${secret}`, secret));
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
