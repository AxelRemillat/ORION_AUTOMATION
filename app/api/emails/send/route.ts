import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNow } from "@/lib/outbox/send";

/**
 * POST /api/emails/send — envoi semi-automatique d'un message en brouillon.
 *
 * Le mail part de n8n (compte Gmail Workspace d'Axel). Toute la logique —
 * règles (corbeille, « ne plus contacter », plafond du jour), webhook, état
 * applicatif — vit dans lib/outbox/send.ts, partagée avec l'envoi programmé.
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const to = payload?.to;
  const messageId = payload?.message_id;
  const prospectId = payload?.prospect_id;

  if (typeof to !== "string" || typeof messageId !== "string" || typeof prospectId !== "string") {
    return NextResponse.json(
      { error: "Payload invalide : { to (email), prospect_id, message_id } sont requis." },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

  const result = await sendNow(supabase, { userId: user.id, messageId, prospectId, to });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({
    ok: true,
    message_id: result.messageId,
    sent_at: result.sentAt,
    prospect_status: result.prospectStatus,
    reminder_due_at: result.reminderDueAt,
  });
}
