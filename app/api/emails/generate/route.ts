import { NextResponse } from "next/server";
import { getOpenAI, OPENAI_MODEL } from "@/lib/openai";
import { findDecisionMaker, hasHunterKey } from "@/lib/enrichment/hunter";
import { toDomain } from "@/lib/enrichment/http";
import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";
// Garde d'authentification partagée avec les routes /api/prospects.
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { buildContext, parseAnalysis, SYSTEM_PROMPT, type Analysis } from "./prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** L'analyse + la rédaction tiennent largement dans 30 s. */
export const maxDuration = 60;

interface GenerateBody {
  prospectId?: string;
}

/** Appel OpenAI en mode JSON : le prompt impose déjà la forme de la réponse. */
async function runAnalysis(prospect: Prospect): Promise<Analysis | null> {
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildContext(prospect) },
    ],
  });
  return parseAnalysis(completion.choices[0]?.message?.content ?? "");
}

/** Recherche du décideur — best effort, jamais bloquante. */
async function findContact(
  prospect: Prospect,
): Promise<{ contact: DecisionMakerContact | null; warning?: EnrichmentWarning }> {
  const domain = toDomain(prospect.website);
  if (!domain) {
    return { contact: null, warning: { source: "hunter", message: "aucun site connu pour ce prospect" } };
  }
  if (!hasHunterKey()) {
    return { contact: null, warning: { source: "hunter", message: "clé absente : email du décideur non recherché" } };
  }

  const leader = typeof prospect.key_figures?.leader === "string" ? prospect.key_figures.leader : null;
  const result = await findDecisionMaker(domain, leader);
  if (!result.ok) return { contact: null, warning: { source: "hunter", message: result.error } };
  return { contact: result.data };
}

/** Analyse IA + email personnalisé + contact décideur pour un prospect. */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<GenerateBody>(request);
  if (!body?.prospectId) {
    return NextResponse.json({ error: "Prospect manquant." }, { status: 400 });
  }

  const { data: prospect, error } = await session.supabase
    .from("prospects")
    .select("*")
    .eq("id", body.prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY absente : la génération est indisponible. Voir .env.local.example." },
      { status: 503 },
    );
  }

  // Les deux appels sont indépendants : on ne paie pas leur latence deux fois.
  const [analysisOutcome, contactOutcome] = await Promise.allSettled([
    runAnalysis(prospect),
    findContact(prospect),
  ]);

  if (analysisOutcome.status === "rejected" || !analysisOutcome.value) {
    const reason =
      analysisOutcome.status === "rejected" && analysisOutcome.reason instanceof Error
        ? analysisOutcome.reason.message
        : "réponse inexploitable";
    return NextResponse.json({ error: `Génération impossible : ${reason}` }, { status: 502 });
  }

  const contactResult =
    contactOutcome.status === "fulfilled" ? contactOutcome.value : { contact: null, warning: undefined };

  // Hunter est la principale source d'adresses : on retient sa trouvaille sur la
  // fiche pour que l'envoi la propose ensuite sans repayer un appel. On n'écrase
  // jamais une adresse déjà connue, et un échec d'écriture ne bloque pas la
  // génération — l'email reste affiché dans le panneau d'analyse.
  if (contactResult.contact && !prospect.email) {
    await session.supabase
      .from("prospects")
      .update({ email: contactResult.contact.email })
      .eq("id", prospect.id);
  }

  return NextResponse.json({
    ...analysisOutcome.value,
    contact: contactResult.contact,
    warnings: contactResult.warning ? [contactResult.warning] : [],
  });
}
