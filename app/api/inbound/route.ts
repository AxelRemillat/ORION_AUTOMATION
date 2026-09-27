import { NextResponse } from "next/server";
import { INBOUND_SECRET_HEADER, secretMatches } from "@/lib/inbound/secret";
import { createAdminClient } from "@/lib/supabase/server";
import { advanceStatus } from "@/lib/constants";
import { INBOUND_CATEGORIES, type InboundCategory, type ProspectStatus } from "@/types";

/**
 * POST /api/inbound — réception d'un email trié par n8n.
 *
 * Confidentialité : n8n ne poste ici que les emails que son classifieur a
 * marqués « liés à la prospection ». La boîte personnelle n'est jamais ingérée.
 * Le filtrage est en amont, l'app ne voit passer que le sous-ensemble retenu.
 *
 * Ce webhook est PUBLIC et écrit en base : il est donc protégé par un secret
 * partagé, et il écrit avec la clé service_role (aucune session côté n8n).
 *
 * Principe de robustesse : un échec applicatif ne doit jamais faire échouer le
 * workflow n8n, qui rejouerait l'email indéfiniment. En dehors du refus
 * d'authentification et d'un payload inexploitable, on répond toujours 200 en
 * décrivant ce qui a été fait.
 *
 * Contrat détaillé : docs/n8n-inbound.md
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InboundBody {
  from_email?: unknown;
  subject?: unknown;
  body?: unknown;
  thread_id?: unknown;
  /** Identifiant Gmail du mail reçu : une réponse programmée s'y rattache. */
  gmail_message_id?: unknown;
  message_id?: unknown;
  received_at?: unknown;
  category?: unknown;
}

/** Extrait l'adresse d'un en-tête « Nom <adresse@ex.fr> » ou d'une adresse nue. */
function parseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const angled = raw.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

const asText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

function parseCategory(value: unknown): InboundCategory {
  return INBOUND_CATEGORIES.includes(value as InboundCategory)
    ? (value as InboundCategory)
    : "autre";
}

/** Date fournie par n8n, si elle est exploitable ; sinon maintenant. */
function parseDate(value: unknown): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

export async function POST(request: Request) {
  const expected = process.env.INBOUND_WEBHOOK_SECRET;
  if (!expected) {
    // Sans secret configuré, l'endpoint resterait un point d'écriture ouvert.
    return NextResponse.json({ error: "Réception non configurée." }, { status: 503 });
  }
  if (!secretMatches(request.headers.get(INBOUND_SECRET_HEADER), expected)) {
    return NextResponse.json({ error: "Secret invalide." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as InboundBody | null;
  const fromEmail = parseEmail(payload?.from_email);
  const body = asText(payload?.body, 20_000);

  if (!fromEmail || !body) {
    return NextResponse.json(
      { error: "Payload invalide : from_email (adresse) et body (texte) sont requis." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // --- À qui appartient cet email ? ---------------------------------------
  // Instance mono-compte : le propriétaire est celui du prospect correspondant,
  // ou, à défaut de correspondance, le titulaire du portefeuille.
  const { data: prospect } = await supabase
    .from("prospects")
    .select("id, user_id, status, deleted_at")
    .ilike("email", fromEmail)
    .limit(1)
    .maybeSingle();

  let ownerId = prospect?.user_id ?? null;
  if (!ownerId) {
    const { data: anyProspect } = await supabase
      .from("prospects")
      .select("user_id")
      .limit(1)
      .maybeSingle();
    ownerId = anyProspect?.user_id ?? null;
  }
  if (!ownerId) {
    // Base encore vide : rien à quoi rattacher l'email. On le dit sans erreur,
    // pour que n8n n'entre pas en boucle de rejeu.
    return NextResponse.json({
      ok: false,
      stored: false,
      reason: "aucun compte propriétaire identifiable (portefeuille vide)",
    });
  }

  // --- Enregistrement ------------------------------------------------------
  const receivedAt = parseDate(payload?.received_at);
  const { data: inserted, error } = await supabase
    .from("inbound_messages")
    .insert({
      user_id: ownerId,
      prospect_id: prospect?.id ?? null,
      from_email: fromEmail,
      subject: asText(payload?.subject, 500),
      body,
      category: parseCategory(payload?.category),
      thread_id: asText(payload?.thread_id, 200),
      gmail_message_id: asText(payload?.gmail_message_id ?? payload?.message_id, 200),
      received_at: receivedAt,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = le même email a déjà été reçu. Un rejeu n8n est normal, pas une
    // erreur : on le signale sans faire échouer le workflow.
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { ok: duplicate, stored: false, duplicate, reason: error.message },
      { status: duplicate ? 200 : 500 },
    );
  }

  // --- Le prospect a répondu : on fait avancer son statut ------------------
  let newStatus: ProspectStatus | null = null;
  // Prospect à la corbeille : l'email reste rattaché (il réapparaît à la
  // restauration) mais le statut ne bouge pas — il sera restauré tel quel.
  if (prospect && !prospect.deleted_at) {
    newStatus = advanceStatus(prospect.status as ProspectStatus, "repondu");
    if (newStatus) {
      await supabase.from("prospects").update({ status: newStatus }).eq("id", prospect.id);
    }
  }

  return NextResponse.json({
    ok: true,
    stored: true,
    inbound_id: inserted.id,
    matched_prospect_id: prospect?.id ?? null,
    prospect_status: newStatus,
  });
}
