/**
 * Resolution de l'alias `@/` pour le harnais de test.
 *
 * tsc compile les imports `@/lib/...` mais emet `require("@/lib/...")` tel
 * quel : Node ne sait pas le resoudre. Ce petit crochet le renvoie vers la
 * sortie compilee. Charge via `node -r ./scripts/alias.cjs`.
 */
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..", ".test-build");
const original = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
  const target = request.startsWith("@/") ? path.join(ROOT, request.slice(2)) : request;
  return original.call(this, target, ...rest);
};
