import { NextResponse } from "next/server";
import { getOpenAI } from "@/lib/openai";
import { modelFor, reasoningEffortFor } from "@/lib/ai/models";
import { buildParams, isTimeoutError } from "@/lib/ai/params";
import { withParamFallback } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { activeProspects, TRASHED_ERROR } from "@/lib/trash/scope";
import type { InboundMessage, Message, Prospect } from "@/types";
import {
  buildReplyContext,
  buildReplySystemPrompt,
  buildThread,
  parseReplyDraft,
} from "./prompt";

/**
 * POST /api/emails/reply — brouillon de réponse à un email entrant.
 *
 * Ne fait que PROPOSER : rien n'est enregistré, rien n'est envoyé. La
 * validation manuelle reste le seul chemin vers l'envoi, comme pour les mails
 * à froid. L'écran présente le brouillon, l'utilisateur l'édite, puis déclenche
 * le pipeline n8n existant.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Budget de l'appel au modèle, volontairement SOUS `maxDuration`.
 *
 * L'enjeu n'est pas la patience : c'est de garder la main. Si la plateforme
 * coupe la fonction, l'écran reçoit un `504` de passerelle sans corps JSON et
 * n'a rien à afficher. En s'arrêtant à 45 s, la route revient avec son propre
 * message, que le composeur montre tel quel.
 *
 * `maxRetries: 0` : une reprise du SDK pourrait doubler l'attente et repasser
 * au-dessus des 60 s. Ici on préfère échouer vite et le dire.
 */
const MODEL_BUDGET_MS = 45_000;

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<{ inboundId?: string }>(request);
  if (!body?.inboundId) {
    return NextResponse.json({ error: "Message entrant manquant." }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY absente : la génération est indisponible." },
      { status: 503 },
    );
  }

  // La RLS restreint déjà à l'utilisateur courant.
  const { data: inbound } = await session.supabase
    .from("inbound_messages")
    .select("*")
    .eq("id", body.inboundId)
    .maybeSingle();

  if (!inbound) return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  const answering = inbound as InboundMessage;

  // --- Contexte : la fiche prospect et tout l'historique --------------------
  let prospect: Prospect | null = null;
  let messages: Message[] = [];
  let inbounds: InboundMessage[] = [answering];

  if (answering.prospect_id) {
    const [prospectResult, messagesResult, inboundResult] = await Promise.all([
      activeProspects(session.supabase).eq("id", answering.prospect_id).maybeSingle(),
      session.supabase
        .from("messages")
        .select("*")
        .eq("prospect_id", answering.prospect_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("inbound_messages")
        .select("*")
        .eq("prospect_id", answering.prospect_id)
        .order("received_at", { ascending: true }),
    ]);
    prospect = (prospectResult.data as Prospect) ?? null;
    if (!prospect) return NextResponse.json({ error: TRASHED_ERROR }, { status: 409 });
    messages = (messagesResult.data ?? []) as Message[];
    inbounds = ((inboundResult.data ?? []) as InboundMessage[]) ?? [answering];
  }

  const thread = buildThread(messages, inbounds);

  try {
    const model = modelFor("writer");
    const completion = await withParamFallback(
      model,
      () => buildParams({ model, temperature: 0.6, reasoningEffort: reasoningEffortFor("writer") }),
      (params) =>
        getOpenAI().chat.completions.create(
          {
            ...(params as { model: string }),
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: buildReplySystemPrompt(answering.category) },
              { role: "user", content: buildReplyContext(prospect, thread, answering) },
            ],
          },
          { timeout: MODEL_BUDGET_MS, maxRetries: 0 },
        ),
    );

    if (completion.usage) {
      await recordOpenAiUsage({
        model,
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        operation: "reply",
        prospectId: answering.prospect_id,
      });
    }

    const draft = parseReplyDraft(
      completion.choices[0]?.message?.content ?? "",
      answering.subject,
    );
    if (!draft) {
      return NextResponse.json(
        { error: "Réponse du modèle inexploitable. Réessayez." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ...draft, threadLength: thread.length });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "inconnue";
    // Un dépassement de délai se dit autrement qu'une panne : l'utilisateur
    // peut réessayer tout de suite, et c'est l'information utile.
    const timedOut = isTimeoutError(error);
    return NextResponse.json(
      {
        error: timedOut
          ? `Le modèle ${modelFor("writer")} n'a pas répondu en ${MODEL_BUDGET_MS / 1000} s. Réessayez.`
          : `Génération impossible : ${reason}`,
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}
