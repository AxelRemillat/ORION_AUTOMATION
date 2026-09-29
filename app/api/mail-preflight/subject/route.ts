import { NextResponse } from "next/server";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import { signatureFor } from "@/lib/offer/model";
import { loadOffer } from "@/lib/offer/read";
import { liveSubjectAsk } from "@/lib/mail-preflight/server";
import { proposeSubject } from "@/lib/mail-preflight/subject-ai";

export const runtime = "nodejs";

/** POST /api/mail-preflight/subject {body} → un objet cohérent avec le corps actuel (1 appel). */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;
  const input = (await readJson<{ body?: string; prospectId?: string }>(request)) ?? {};
  if (!input.body?.trim()) return NextResponse.json({ error: "Corps vide." }, { status: 400 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI n'est pas configuré." }, { status: 503 });

  const { offer } = await loadOffer(session.supabase, session.userId);
  const subject = await proposeSubject(liveSubjectAsk("preflight:objet", input.prospectId ?? null), {
    body: input.body,
    signature: signatureFor(offer),
  }).catch(() => null);
  return subject
    ? NextResponse.json({ subject })
    : NextResponse.json({ error: "Aucun objet proposé : réessayez." }, { status: 502 });
}
