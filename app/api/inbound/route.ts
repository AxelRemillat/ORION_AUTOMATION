import { NextResponse } from "next/server";
import { INBOUND_SECRET_HEADER, secretMatches } from "@/lib/inbound/secret";
import { createAdminClient } from "@/lib/supabase/server";
import { cancelRelancesOnReply } from "@/lib/outbox/relances";
import { setDoNotContact } from "@/lib/outbox/do-not-contact";
import { advanceStatus } from "@/lib/constants";
import { INBOUND_CATEGORIES, type InboundCategory, type ProspectStatus } from "@/types";
import { absenceReturnDate, autoReplyKind } from "@/lib/inbound/auto-reply";
import { findAntispamProspect, shiftFollowUpsAfterReturn } from "@/lib/inbound/auto-reply-server";
import type { Db } from "@/lib/trash/scope";

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
  /** En-tête `Auto-Submitted` (auto-replied, auto-generated), si n8n le transmet. */
  auto_submitted?: unknown;
  headers?: unknown;
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

  // Réponse AUTOMATIQUE (challenge anti-spam, absence) : pas une réponse du
  // prospect. Stockée et affichée, mais sans aucun effet de « réponse ».
  const headers = payload?.headers && typeof payload.headers === "object" ? (payload.headers as Record<string, unknown>) : {};
  const autoSubmitted = asText(payload?.auto_submitted ?? headers["auto-submitted"] ?? headers["Auto-Submitted"], 100);
  const autoKind = autoReplyKind({ from_email: fromEmail, subject: asText(payload?.subject, 500), body, auto_submitted: autoSubmitted });

  // --- À qui appartient cet email ? ---------------------------------------
  // Instance mono-compte : le propriétaire est celui du prospect correspondant,
  // ou, à défaut de correspondance, le titulaire du portefeuille.
  let { data: prospect } = await supabase
    .from("prospects")
    .select("id, user_id, status, deleted_at")
    .ilike("email", fromEmail)
    .limit(1)
    .maybeSingle();
  // Challenge anti-spam : l'expéditeur est le service, pas le prospect.
  if (!prospect && autoKind === "antispam") {
    const found = await findAntispamProspect(supabase as unknown as Db, { from_email: fromEmail, subject: asText(payload?.subject, 500), body });
    if (found) {
      const { data } = await supabase.from("prospects").select("id, user_id, status, deleted_at").eq("id", found.id).maybeSingle();
      prospect = data;
    }
  }

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
  const category = parseCategory(payload?.category);
  const { data: inserted, error } = await supabase
    .from("inbound_messages")
    .insert({
      user_id: ownerId,
      prospect_id: prospect?.id ?? null,
      from_email: fromEmail,
      subject: asText(payload?.subject, 500),
      body,
      category,
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

  /*
   * UN « STOP » EST UN REFUS, ET IL S'HONORE TOUT DE SUITE.
   *
   * Chaque mail porte la phrase « un simple stop en réponse et je ne vous
   * relancerai pas » (lib/mail-preflight/opt-out.ts). La tenir ne peut pas
   * dépendre d'un geste manuel : la catégorie « refus », posée par le
   * classifieur n8n, coche « ne plus contacter » — ce qui annule au passage
   * tous les envois programmés (lib/outbox/do-not-contact.ts).
   */
  let doNotContact = false;
  if (prospect && !prospect.deleted_at && category === "refus" && !autoKind) {
    const outcome = await setDoNotContact(supabase as never, prospect.id, true);
    doNotContact = outcome.ok;
  }

  // --- Le prospect a répondu : on fait avancer son statut ------------------
  let newStatus: ProspectStatus | null = null;
  // Prospect à la corbeille : l'email reste rattaché (il réapparaît à la
  // restauration) mais le statut ne bouge pas — il sera restauré tel quel.
  // « Ne plus contacter » a déjà posé le statut « perdu » : on n'y touche plus.
  if (prospect && !prospect.deleted_at && !doNotContact && !autoKind) {
    newStatus = advanceStatus(prospect.status as ProspectStatus, "repondu");
    if (newStatus) {
      await supabase.from("prospects").update({ status: newStatus }).eq("id", prospect.id);
    }
  }

  // Une réponse annule les relances programmées de ce prospect. Une réponse
  // automatique non : une absence datée les repousse après le retour, un
  // challenge anti-spam ne change rien.
  const cancelledRelances = prospect && !autoKind
    ? await cancelRelancesOnReply(supabase, { userId: ownerId, prospectId: prospect.id, receivedAt })
    : 0;
  const returnDate = autoKind === "absence" ? absenceReturnDate({ from_email: fromEmail, subject: asText(payload?.subject, 500), body, received_at: receivedAt }) : null;
  const shiftedRelances = prospect && !prospect.deleted_at && returnDate
    ? await shiftFollowUpsAfterReturn(supabase as unknown as Db, { userId: ownerId, prospectId: prospect.id, returnDate })
    : 0;

  return NextResponse.json({
    ok: true,
    stored: true,
    inbound_id: inserted.id,
    matched_prospect_id: prospect?.id ?? null,
    prospect_status: newStatus,
    cancelled_relances: cancelledRelances,
    auto_reply: autoKind,
    return_date: returnDate,
    shifted_relances: shiftedRelances,
    do_not_contact: doNotContact,
  });
}
