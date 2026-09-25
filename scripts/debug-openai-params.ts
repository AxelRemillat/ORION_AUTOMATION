/**
 * Sonde les capacités RÉELLES d'un modèle OpenAI, paramètre par paramètre.
 *
 * La table `lib/ai/params.ts` ne doit rien supposer : chaque ligne vient d'un
 * appel qui a réellement été accepté ou refusé. C'est ce script qui l'établit.
 *
 *   npx tsx scripts/debug-openai-params.ts gpt-6-luna gpt-6-sol
 *
 * CONSOMME DES APPELS PAYANTS (quelques dizaines de tokens par essai).
 */
import { existsSync, readFileSync } from "node:fs";
import OpenAI from "openai";

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY as string });

const MESSAGES = [
  // Le mot « json » DOIT figurer dans les messages pour que l'API accepte
  // `response_format: json_object` : sans lui, le refus vient de la requete,
  // pas du modele, et la sonde conclurait a tort.
  { role: "system" as const, content: "Reponds UNIQUEMENT avec un objet json : {\"ok\": true}." },
  { role: "user" as const, content: "ok ?" },
];

interface Attempt {
  label: string;
  body: Record<string, unknown>;
}

/** Ce qu'on veut savoir de chaque modèle, un paramètre à la fois. */
function attempts(model: string): Attempt[] {
  return [
    { label: "nu (aucun paramètre)", body: {} },
    { label: "temperature: 0", body: { temperature: 0 } },
    { label: "temperature: 1", body: { temperature: 1 } },
    { label: "top_p: 1", body: { top_p: 1 } },
    { label: "max_tokens", body: { max_tokens: 2048 } },
    { label: "max_completion_tokens", body: { max_completion_tokens: 2048 } },
    { label: "reasoning_effort: low", body: { reasoning_effort: "low" } },
    { label: "response_format json_object", body: { response_format: { type: "json_object" } } },
    {
      label: "response_format json_schema",
      body: {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "probe",
            strict: true,
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        },
      },
    },
  ].map((item) => ({ ...item, body: { ...item.body, model } }));
}

interface Verdict {
  label: string;
  ok: boolean;
  code?: string;
  param?: string;
  message?: string;
}

function readError(error: unknown): { code?: string; param?: string; message: string } {
  const anyError = error as {
    status?: number;
    code?: string;
    param?: string;
    error?: { code?: string; param?: string; message?: string };
    message?: string;
  };
  return {
    code: anyError.error?.code ?? anyError.code,
    param: anyError.error?.param ?? anyError.param,
    message: anyError.error?.message ?? anyError.message ?? String(error),
  };
}

async function probe(model: string): Promise<void> {
  console.log(`\n${"=".repeat(72)}\n${model}\n${"=".repeat(72)}`);
  const verdicts: Verdict[] = [];

  for (const attempt of attempts(model)) {
    try {
      const completion = await client.chat.completions.create({
        ...(attempt.body as { model: string }),
        messages: MESSAGES,
      });
      const text = (completion.choices[0]?.message?.content ?? "").slice(0, 40).replace(/\s+/g, " ");
      verdicts.push({ label: attempt.label, ok: true });
      console.log(`  ACCEPTE  ${attempt.label.padEnd(32)} → ${text}`);
    } catch (error) {
      const info = readError(error);
      verdicts.push({ label: attempt.label, ok: false, ...info });
      console.log(
        `  REFUSE   ${attempt.label.padEnd(32)} → ${info.code ?? "?"}` +
          `${info.param ? ` (param ${info.param})` : ""} : ${info.message.slice(0, 110)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const models = process.argv.slice(2);
  if (!models.length) {
    console.log("usage : npx tsx scripts/debug-openai-params.ts <modele> [<modele>...]");
    return;
  }
  for (const model of models) await probe(model);
  console.log("");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
