import { existsSync, readFileSync } from "node:fs";
function loadEnv(f = ".env.local"): void {
  if (!existsSync(f)) return;
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();
async function main() {
  const { chatJson } = await import("../lib/ai/chat");
  const { getOpenAI } = await import("../lib/openai");
  const { triageModel } = await import("../lib/funnel/triage");
  console.log("modèle:", triageModel());
  const out = await chatJson({
    client: getOpenAI(),
    role: "extract",
    model: triageModel(),
    system: "Réponds en JSON strict : { \"items\": [ { \"id\": \"a\" } ] }",
    user: "Renvoie un item d'id « a ».",
    temperature: 0,
    operation: "probe:triage",
  });
  console.log("réponse:", out.slice(0, 200));
}
main().catch((e: unknown) => { console.error("ERREUR:", e instanceof Error ? e.message : e); process.exit(1); });
