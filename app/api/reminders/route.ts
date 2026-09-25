import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isActiveProspect, TRASHED_ERROR } from "@/lib/trash/scope";

/**
 * GET  /api/reminders?scope=due|open — relances ouvertes (dues aujourd'hui par défaut).
 * POST /api/reminders — planifie une relance ({ prospect_id, due_at } ou { prospect_id, in_days }).
 *
 * Utilisé par la page Suivi et par le cron n8n optionnel (cf. docs/n8n.md).
 */

/** Fin de la journée courante : une relance due « aujourd'hui » est incluse. */
function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

export async function GET(request: Request) {
  const supabase = createClient();
  const scope = new URL(request.url).searchParams.get("scope") ?? "due";

  let query = supabase
    .from("reminders")
    .select("id, prospect_id, due_at, done, created_at, prospects(company_name, status, deleted_at)")
    .eq("done", false)
    .order("due_at", { ascending: true });

  if (scope === "due") query = query.lte("due_at", endOfToday());

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Relances d'un prospect à la corbeille : suspendues, n8n ne les voit pas.
  const reminders = (data ?? []).filter((row) => {
    const owner = (row as { prospects?: { deleted_at?: string | null } | null }).prospects;
    return !owner?.deleted_at;
  });
  return NextResponse.json({ reminders });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const prospectId = payload?.prospect_id;
  if (typeof prospectId !== "string") {
    return NextResponse.json({ error: "prospect_id est requis." }, { status: 400 });
  }

  const inDays = typeof payload?.in_days === "number" ? payload.in_days : null;
  const dueAt =
    typeof payload?.due_at === "string"
      ? payload.due_at
      : new Date(Date.now() + (inDays ?? 4) * 86_400_000).toISOString();

  if (Number.isNaN(Date.parse(dueAt))) {
    return NextResponse.json({ error: "due_at n'est pas une date valide." }, { status: 400 });
  }

  const supabase = createClient();
  if (!(await isActiveProspect(supabase, prospectId))) {
    return NextResponse.json({ error: TRASHED_ERROR }, { status: 409 });
  }
  const { data, error } = await supabase
    .from("reminders")
    .insert({ prospect_id: prospectId, due_at: dueAt, done: false })
    .select("id, prospect_id, due_at, done, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reminder: data }, { status: 201 });
}
