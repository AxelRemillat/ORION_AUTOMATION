import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH  /api/reminders/[id] — { done, due_at? } : solder ou reporter une relance.
 * DELETE /api/reminders/[id] — supprime la relance.
 */

type Params = { params: { id: string } };

export async function PATCH(request: Request, { params }: Params) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  const patch: { done?: boolean; due_at?: string } = {};
  if (typeof payload?.done === "boolean") patch.done = payload.done;
  if (typeof payload?.due_at === "string") {
    if (Number.isNaN(Date.parse(payload.due_at))) {
      return NextResponse.json({ error: "due_at n'est pas une date valide." }, { status: 400 });
    }
    patch.due_at = payload.due_at;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Rien à mettre à jour (done, due_at)." }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("reminders")
    .update(patch)
    .eq("id", params.id)
    .select("id, prospect_id, due_at, done, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Relance introuvable." }, { status: 404 });
  return NextResponse.json({ reminder: data });
}

export async function DELETE(_request: Request, { params }: Params) {
  const supabase = createClient();
  const { error } = await supabase.from("reminders").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
