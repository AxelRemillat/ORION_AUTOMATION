import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, requireSession } from "@/app/api/prospects/_guard";

/**
 * POST /api/offer — enregistre « Mon offre ».
 *
 * Une seule ligne par utilisateur, écrite d'un bloc : ces champs se lisent
 * ensemble quand un mail se construit, et les enregistrer séparément laisserait
 * des états incohérents — une signature sans titre, une preuve sans phrase.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROOF = z.object({
  id: z.string().min(1).max(60),
  title: z.string().max(120),
  sentence: z.string().max(400),
  tags: z.array(z.string().max(60)).max(20),
  url: z.string().max(400).nullable().optional(),
  publicOk: z.boolean(),
});

const OFFER = z.object({
  full_name: z.string().max(120).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  portfolio_url: z.string().max(400).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  show_phone: z.boolean().optional(),
  entry_type: z.enum(["demo", "appel", "audit", "pilote"]).nullable().optional(),
  entry_duration: z.string().max(60).nullable().optional(),
  entry_pitch: z.string().max(400).nullable().optional(),
  entry_url: z.string().max(400).nullable().optional(),
  lead_time: z.string().max(60).nullable().optional(),
  no_tool_change: z.boolean().optional(),
  human_validation: z.boolean().optional(),
  proofs: z.array(PROOF).max(20).optional(),
});

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsed = z.object({ offer: OFFER }).safeParse(await readJson<unknown>(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Offre invalide." }, { status: 400 });
  }

  // `upsert` sur la clé primaire : la première sauvegarde crée la ligne.
  const { error } = await session.supabase.from("user_offer").upsert(
    { ...parsed.data.offer, user_id: session.userId, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: `Enregistrement impossible : ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
