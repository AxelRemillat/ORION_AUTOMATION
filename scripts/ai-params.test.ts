/**
 * Tests des paramètres d'appel par modèle et du limiteur de débit.
 *
 * Les capacités figées ici viennent d'appels RÉELS du 25/09/2026, relevés par
 * `npx tsx scripts/debug-openai-params.ts gpt-6-luna gpt-6-sol`. Elles ne sont
 * pas supposées.
 *
 * Exécution : `npm run test:ai-params`.
 */
import {
  buildParams,
  capabilitiesOf,
  capabilityToDrop,
  isUnsupportedParamError,
  readOpenAiError,
  rememberUnsupported,
  resetLearnedCapabilities,
} from "../lib/ai/params";
import { backoffDelayMs, limitedFetch, resetRateLimiters } from "../lib/enrichment/rate-limit";
import { isStaleFinance } from "../lib/emails/derived-facts";
import { whyNow } from "../lib/scoring";
import type { ProspectSignal } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("\n1. Capacités par modèle");
  {
    resetLearnedCapabilities();

    for (const model of ["gpt-6-sol", "gpt-6-luna", "gpt-5", "o3-mini"]) {
      const caps = capabilitiesOf(model);
      check(`${model} : pas de temperature`, !caps.supportsTemperature);
      check(`${model} : max_completion_tokens`, caps.maxOutputParam === "max_completion_tokens");
    }

    const classic = capabilitiesOf("gpt-4o-mini");
    check("gpt-4o-mini : temperature acceptée", classic.supportsTemperature);
    check("gpt-4o-mini : max_tokens", classic.maxOutputParam === "max_tokens");

    const chat = capabilitiesOf("gpt-5-chat");
    check("une variante -chat reprend la température", chat.supportsTemperature);

    // Un modèle inconnu ne doit jamais faire tomber la chaîne en 400.
    const unknown = capabilitiesOf("modele-de-demain-v9");
    check("modèle inconnu : repli prudent", !unknown.supportsTemperature && !unknown.supportsReasoningEffort);
  }

  console.log("\n2. buildParams n'envoie que ce qui est accepté");
  {
    resetLearnedCapabilities();

    // Le cas exact de l'incident : temperature 0 sur gpt-6-luna.
    const luna = buildParams({ model: "gpt-6-luna", temperature: 0, reasoningEffort: "low", maxOutputTokens: 2048 });
    check("pas de temperature", !("temperature" in luna), JSON.stringify(luna));
    check("pas de top_p", !("top_p" in luna));
    check("reasoning_effort transmis", luna.reasoning_effort === "low");
    check("budget sous le bon nom", luna.max_completion_tokens === 2048 && !("max_tokens" in luna));

    const legacy = buildParams({ model: "gpt-4o-mini", temperature: 0.85, reasoningEffort: "low", maxOutputTokens: 512 });
    check("modèle classique : temperature conservée", legacy.temperature === 0.85);
    check("modèle classique : pas de reasoning_effort", !("reasoning_effort" in legacy));
    check("modèle classique : max_tokens", legacy.max_tokens === 512);

    check("sans budget demandé, aucun plafond envoyé", !("max_completion_tokens" in buildParams({ model: "gpt-6-sol" })));
  }

  console.log("\n3. Filet de sécurité : le refus est appris");
  {
    resetLearnedCapabilities();

    const erreur = {
      status: 400,
      error: {
        code: "unsupported_value",
        param: "temperature",
        message: "Unsupported value: 'temperature' does not support 0 with this model.",
      },
    };
    const info = readOpenAiError(erreur);
    check("erreur lue", info.code === "unsupported_value" && info.param === "temperature");
    check("classée comme paramètre refusé", isUnsupportedParamError(info));
    check("un refus sans code est reconnu au message", isUnsupportedParamError({ message: "Unsupported parameter: 'max_tokens'" }));
    check("une panne réseau n'en est pas un", !isUnsupportedParamError({ message: "socket hang up" }));

    check("temperature → capacité retirée", capabilityToDrop("temperature")?.supportsTemperature === false);
    check("max_tokens → on bascule de nom", capabilityToDrop("max_tokens")?.maxOutputParam === "max_completion_tokens");
    check("paramètre inconnu → rien à retirer", capabilityToDrop("machin") === null);

    // Un modèle classique qui refuserait la température doit s'en souvenir.
    check("avant apprentissage", buildParams({ model: "gpt-4o-mini", temperature: 0.5 }).temperature === 0.5);
    rememberUnsupported("gpt-4o-mini", { supportsTemperature: false });
    check(
      "après apprentissage, le paramètre ne repart plus",
      !("temperature" in buildParams({ model: "gpt-4o-mini", temperature: 0.5 })),
    );
    resetLearnedCapabilities();
    check("la mémoire se remet à zéro", buildParams({ model: "gpt-4o-mini", temperature: 0.5 }).temperature === 0.5);
  }

  console.log("\n4. Reprise sur 429");
  {
    check("Retry-After fait autorité", backoffDelayMs(0, "5") === 5000);
    check("Retry-After plafonné", backoffDelayMs(0, "9999") === 30_000);
    const sansHeader = backoffDelayMs(2, null, () => 0.5);
    check("sans en-tête : exponentiel", sansHeader === 2000, String(sansHeader));
    const a = backoffDelayMs(1, null, () => 0);
    const b = backoffDelayMs(1, null, () => 1);
    check("le bruit écarte deux reprises simultanées", a !== b, `${a} vs ${b}`);

    resetRateLimiters();
    let appels = 0;
    const result = await limitedFetch("https://exemple.test/x", {
      key: "test-429",
      ratePerSecond: 100,
      attempts: 3,
      fetchImpl: async () => {
        appels += 1;
        // Deux 429 puis un succès : la reprise doit aboutir.
        return appels < 3
          ? new Response("", { status: 429, headers: { "retry-after": "0" } })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      onRetry: () => {},
    });
    check("trois tentatives, succès au bout", result.response?.status === 200 && appels === 3, `${appels} appel(s)`);

    resetRateLimiters();
    let echecs = 0;
    const perdu = await limitedFetch("https://exemple.test/y", {
      key: "test-429-perdu",
      ratePerSecond: 100,
      attempts: 2,
      fetchImpl: async () => {
        echecs += 1;
        return new Response("", { status: 429, headers: { "retry-after": "0" } });
      },
      onRetry: () => {},
    });
    check("échec explicite, pas silencieux", Boolean(perdu.error?.includes("429")), String(perdu.error));
    check("le nombre de tentatives est respecté", echecs === 2, `${echecs}`);
  }

  console.log("\n5. Le limiteur espace réellement les départs");
  {
    resetRateLimiters();
    const started = Date.now();
    await Promise.all(
      [1, 2, 3, 4].map(() =>
        limitedFetch("https://exemple.test/z", {
          key: "test-debit",
          ratePerSecond: 5,
          attempts: 1,
          fetchImpl: async () => new Response("{}", { status: 200 }),
        }),
      ),
    );
    const elapsed = Date.now() - started;
    // 4 départs à 5/s : au moins 3 intervalles de 200 ms.
    check("4 appels à 5/s prennent au moins 600 ms", elapsed >= 550, `${elapsed} ms`);
  }

  console.log("\n6. Finances anciennes et agrégateurs");
  {
    const now = new Date("2026-09-25");
    check("un exercice 2017 est ancien", isStaleFinance(2017, now));
    check("un exercice 2024 ne l'est pas", !isStaleFinance(2024, now));
    check("aucune année : rien à dire", !isStaleFinance(null, now));

    const agregateur: ProspectSignal = {
      type: "recrutement",
      label: "Recrutement en cours — fr.trabajo.org",
      url: "https://fr.trabajo.org/emploi-terdici",
      source: "fr.trabajo.org",
      quote: "terdici vegetal 2 offres d'emploi terdici vegetal en France.",
      confidence: 0.7,
      sourceWeight: 0.25,
      date: now.toISOString().slice(0, 10),
    };
    const why = whyNow([agregateur], { now });
    check(
      "l'extrait brut ne s'affiche plus",
      !(why?.headline ?? "").includes("terdici vegetal 2 offres"),
      String(why?.headline),
    );
    check(
      "il est remplacé par ce qu'il dit vraiment",
      why?.headline === "2 offres listées sur un agrégateur (non datées)",
      String(why?.headline),
    );

    // Une vraie offre doit passer devant l'agrégateur.
    const vraie: ProspectSignal = {
      ...agregateur,
      source: "exemple.fr",
      url: "https://exemple.fr/offre-demploi-automaticien",
      quote: "Nous recrutons un automaticien en CDI pour notre site de Lyon.",
      sourceWeight: undefined,
      category: "automation",
      confidence: 0.9,
    };
    const mixte = whyNow([agregateur, vraie], { now });
    check("la vraie offre porte l'accroche", (mixte?.headline ?? "").includes("automaticien"), String(mixte?.headline));
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
