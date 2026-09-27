/**
 * Budget de temps des routes lentes, et message d'erreur de passerelle.
 *
 * Le bug d'origine : « Proposer un brouillon » renvoyait un `504` sans corps
 * JSON, donc sans explication a l'ecran. Deux causes structurelles, deux
 * invariants verrouilles ici :
 *
 *   1. Une route qui appelle une API tierce payante ou lente DOIT declarer son
 *      `maxDuration`. Sans lui elle herite du defaut de la plateforme et se
 *      fait couper en vol. `/api/prospects/enrich` etait dans ce cas.
 *   2. Le budget de l'appel au modele doit rester STRICTEMENT SOUS celui de la
 *      route. Sinon la plateforme coupe avant que le code ait la main, et
 *      l'ecran ne recoit ni notre message ni notre code.
 *
 * Un test qui lit les fichiers plutot que d'importer les routes : un
 * `route.ts` d'App Router n'est pas importable hors du serveur Next.
 *
 * Execution : `npm run test:routes`.
 */
import { readFileSync } from "node:fs";
import { gatewayMessage } from "../lib/enrichment/api-client";
import { OPENAI_MAX_RETRIES, OPENAI_TIMEOUT_MS } from "../lib/openai";
import { isTimeoutError } from "../lib/ai/params";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Routes qui appellent une API tierce payante ou lente.
 *
 * Liste explicite et non deduite : la deduction par graphe d'imports
 * sur-declare (une route qui importe `@/lib/enrichment` pour un TYPE remonte
 * comme appelant OpenAI). Ajouter une route ici est le prix a payer pour que
 * l'oubli du budget echoue ici plutot qu'en production.
 */
const SLOW_ROUTES = [
  "app/api/emails/generate/route.ts",
  "app/api/emails/reply/route.ts",
  "app/api/prospects/enrich/route.ts",
  "app/api/prospects/search/route.ts",
  "app/api/prospects/signals/route.ts",
] as const;

/** Plancher : en dessous, une chaine d'appels tiers n'a aucune chance. */
const MIN_BUDGET_S = 60;

const read = (path: string) => readFileSync(path, "utf8");

const maxDurationOf = (source: string): number | null => {
  const found = /export const maxDuration\s*=\s*(\d+)/.exec(source);
  return found ? Number(found[1]) : null;
};

console.log("\n1. Chaque route lente declare son budget");
{
  for (const path of SLOW_ROUTES) {
    const budget = maxDurationOf(read(path));
    check(
      `${path} declare maxDuration`,
      budget !== null,
      budget === null ? "absent : la plateforme la coupera a son defaut" : "",
    );
    if (budget !== null) {
      check(`${path} >= ${MIN_BUDGET_S} s`, budget >= MIN_BUDGET_S, `${budget} s`);
    }
  }
}

console.log("\n2. Le budget du modele reste sous celui de la route");
{
  const source = read("app/api/emails/reply/route.ts");
  const route = maxDurationOf(source);
  const model = /const MODEL_BUDGET_MS\s*=\s*([\d_]+)/.exec(source);
  check("le budget du modele est declare", model !== null);

  if (route !== null && model) {
    const modelSeconds = Number(model[1].replace(/_/g, "")) / 1000;
    // L'invariant qui compte : la route doit pouvoir REPONDRE apres l'echec du
    // modele. A egalite, la plateforme gagne la course et on perd le message.
    check(
      `${modelSeconds} s < ${route} s`,
      modelSeconds < route,
      `modele ${modelSeconds} s, route ${route} s`,
    );
    check("et il reste au moins 5 s pour repondre", route - modelSeconds >= 5);
  }

  // Le client partage doit lui aussi etre borne : le defaut du SDK est de DIX
  // MINUTES, ce qui garantit la coupure par la plateforme sur toute route.
  check("le client OpenAI est borne", OPENAI_TIMEOUT_MS > 0 && OPENAI_TIMEOUT_MS <= 60_000, `${OPENAI_TIMEOUT_MS} ms`);
  check("et ne se reprend pas indefiniment", OPENAI_MAX_RETRIES <= 1, String(OPENAI_MAX_RETRIES));
}

console.log("\n3. Une coupure de passerelle produit une phrase, pas un code");
{
  // `payload` est `null` sur ces reponses : le message ne peut venir que d'ici.
  for (const status of [504, 408]) {
    const message = gatewayMessage(status);
    check(`${status} parle de temps depasse`, /temps imparti/i.test(message), message);
    check(`${status} invite a reessayer`, /r[ée]essayez/i.test(message), message);
  }
  for (const status of [502, 503]) {
    const message = gatewayMessage(status);
    check(`${status} parle d'indisponibilite`, /indisponible/i.test(message), message);
    check(`${status} invite a reessayer`, /r[ée]essayez/i.test(message), message);
  }
  // Un code sans traitement dedie garde son ancien libelle : pas de phrase
  // inventee pour un cas qu'on ne sait pas expliquer.
  check("un code inconnu reste brut", gatewayMessage(418) === "Erreur 418.", gatewayMessage(418));
  check("aucun message ne se resume au code", !/^Erreur 504\.$/.test(gatewayMessage(504)));
}

console.log("\n4. Un depassement de delai est reconnu comme tel");
{
  // Forme REELLE mesuree contre le SDK v4.104 : un `Error` nu, nomme « Error »,
  // de message « Request timed out. ». Pas la classe qu'on attendrait.
  const sdk = new Error("Request timed out.");
  check("le depassement du SDK est reconnu", isTimeoutError(sdk));

  const named = new Error("boom");
  named.name = "APIConnectionTimeoutError";
  check("la classe dediee aussi, si elle arrive un jour", isTimeoutError(named));

  const aborted = new Error("The operation was aborted");
  check("une annulation est reconnue", isTimeoutError(aborted));

  // Ce qui NE doit pas passer pour un depassement : une vraie panne se dit
  // autrement, et inviter a reessayer serait un mauvais conseil.
  check("un refus de parametre n'en est pas un", !isTimeoutError(new Error("Unsupported value: temperature")));
  check("une cle invalide n'en est pas un", !isTimeoutError(new Error("Incorrect API key provided")));
  check("une valeur non-Error n'en est pas un", !isTimeoutError("timed out"));
  check("null n'en est pas un", !isTimeoutError(null));
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
