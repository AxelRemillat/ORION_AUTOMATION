import { createHash } from "node:crypto";
import type { Notification } from "@/lib/notify/ntfy";
import { ingestOpportunity, type IngestBody, type IngestDeps } from "../ingest";
import { PLATFORM_LABELS, type OpportunityStatus, type Platform } from "../types";
import { ALERT_KINDS, parsePlatformEmail, type EmailKind, type InboundEmail, type ParsedEmail } from "./parse";

/**
 * INGESTION PAR E-MAIL — POST /api/opportunities/ingest-email (workflow n8n
 * Gmail dédié). Un e-mail de plateforme devient :
 *
 *   - une OPPORTUNITÉ (invitation, demande, commande, recommandation ; message
 *     ou offre sans opportunité connue) — même pipeline que la veille Codeur :
 *     pré-filtre, analyse sous échéance, proposition en arrière-plan ;
 *   - ou un ÉVÉNEMENT DE SUIVI rattaché à l'opportunité existante (message,
 *     offre, mission confirmée, clôture), qui fait avancer son statut — jamais
 *     reculer ;
 *   - ou une ligne « à trier » s'il n'est pas reconnu (aucune alerte).
 *
 * Dédoublonnage par message_id : un e-mail rejoué ne fait rien. Alerte ntfy
 * SEULEMENT pour un client qui vient vers Axel (invitation, nouvelle demande,
 * commande). Aucun envoi, aucune candidature : Axel répond lui-même.
 */

type Db = { from: (table: string) => any };

export interface EmailIngestDeps extends Omit<IngestDeps, "notify"> {
  notify?: (notification: Notification) => Promise<unknown>;
}

export type EmailIngestStatus = "cree" | "rattache" | "a_trier";

export interface EmailIngestResponse {
  ok: true;
  message_id: string;
  platform: Platform | null;
  kind: EmailKind;
  status: EmailIngestStatus;
  opportunity_ids: string[];
  alerted: boolean;
  orion_url: string | null;
  duplicate?: true;
  /** Statut de l'opportunité après un événement de suivi. */
  opportunity_status?: OpportunityStatus;
}

const orionUrl = (baseUrl: string, id: string) => `${baseUrl.replace(/\/$/, "")}/opportunites?id=${encodeURIComponent(id)}`;

/** Rang d'avancement : un statut n'avance que vers la droite (« Perdue » à part). */
const RANK: Record<OpportunityStatus, number> = { a_repondre: 0, ignoree: 0, envoyee: 1, reponse: 2, entretien: 3, gagnee: 4, perdue: -1 };

/**
 * Statut après un événement, ou `null` s'il ne bouge pas :
 *   message → « Réponse » (le client a répondu), puis « Conversation » au suivant ;
 *   offre → « Conversation » au moins ; mission confirmée → « Gagnée » ;
 *   clôture → « Perdue », sauf une mission déjà gagnée.
 */
export function statusAfterEvent(current: OpportunityStatus, kind: EmailKind): OpportunityStatus | null {
  const target: OpportunityStatus | null =
    kind === "message" ? (RANK[current] >= RANK.reponse ? "entretien" : "reponse")
    : kind === "offre" ? "entretien"
    : kind === "gagnee" ? "gagnee"
    : kind === "perdue" ? "perdue"
    : null;
  if (!target || target === current) return null;
  if (target === "perdue") return current === "gagnee" || current === "perdue" ? null : "perdue";
  // Une affaire perdue qui reprend (nouveau message, offre) revient dans le suivi.
  if (current === "perdue") return target;
  return RANK[target] > RANK[current] ? target : null;
}

/** Champs datés posés avec un statut (jamais effacés). */
export function milestones(status: OpportunityStatus, current: { sent_at?: string | null; replied_at?: string | null; conversation_at?: string | null; won_at?: string | null }, now: string): Record<string, string> {
  const patch: Record<string, string> = {};
  if (RANK[status] >= RANK.envoyee && !current.sent_at) patch.sent_at = now;
  if (RANK[status] >= RANK.reponse && !current.replied_at) patch.replied_at = now;
  if (RANK[status] >= RANK.entretien && !current.conversation_at) patch.conversation_at = now;
  if (status === "gagnee" && !current.won_at) patch.won_at = now;
  return patch;
}

const normalize = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

interface OpportunityRow {
  id: string;
  status: OpportunityStatus;
  title: string;
  url: string | null;
  external_id: string | null;
  client_name: string | null;
  sent_at: string | null;
  replied_at: string | null;
  conversation_at: string | null;
  won_at: string | null;
}

/**
 * Opportunité existante pour un e-mail de suivi : même identifiant d'annonce,
 * sinon même titre, sinon même client (la plus récente encore ouverte).
 */
export async function findOpportunity(db: Db, userId: string, platform: Platform, parsed: ParsedEmail): Promise<OpportunityRow | null> {
  const { data } = await db
    .from("opportunities")
    .select("id, status, title, url, external_id, client_name, sent_at, replied_at, conversation_at, won_at, created_at")
    .eq("user_id", userId)
    .eq("platform", platform)
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as OpportunityRow[];
  if (parsed.externalId) {
    const id = parsed.externalId.toLowerCase();
    const byId = rows.find((row) => row.external_id?.toLowerCase() === id || (row.url ?? "").toLowerCase().includes(id.replace(/^(malt|comeup):/, "")));
    if (byId) return byId;
  }
  const title = normalize(parsed.title);
  if (title.length >= 12) {
    const byTitle = rows.find((row) => {
      const candidate = normalize(row.title);
      return candidate === title || (candidate.length >= 12 && (candidate.includes(title) || title.includes(candidate)));
    });
    if (byTitle) return byTitle;
  }
  const client = normalize(parsed.clientName);
  if (client.length >= 3) {
    const byClient = rows.find((row) => normalize(row.client_name) === client && row.status !== "ignoree");
    if (byClient) return byClient;
  }
  return null;
}

/** Identifiant stable quand l'e-mail n'en donne pas : empreinte du message_id. */
const fallbackId = (messageId: string) => `email:${createHash("sha256").update(messageId).digest("hex").slice(0, 24)}`;

function alertFor(platform: Platform, kind: EmailKind, parsed: ParsedEmail, url: string, extra: string | null): Notification {
  const what = kind === "invitation" ? "Invitation" : kind === "commande" ? "Nouvelle commande" : "Nouvelle demande";
  const details = [parsed.clientName ? `Client : ${parsed.clientName}.` : null, parsed.budget ? `Budget : ${parsed.budget}.` : null, extra].filter(Boolean).join(" ");
  return {
    title: `${what} ${PLATFORM_LABELS[platform]} : ${parsed.title ?? "sans titre"}`,
    body: details || "Ouvrez la fiche dans ORION pour répondre.",
    priority: "high",
    tags: ["briefcase"],
    click: url,
  };
}

/** Annonce à créer, au format de la veille (même pré-filtre, même analyse). */
function asIngestBody(platform: Platform, parsed: ParsedEmail, messageId: string, receivedAt: string | null): IngestBody {
  const description = [parsed.body, parsed.budget ? `Budget : ${parsed.budget}` : null].filter(Boolean).join("\n\n").slice(0, 20_000);
  return {
    platform,
    external_id: parsed.externalId ?? fallbackId(messageId),
    url: parsed.url,
    title: (parsed.title ?? "Demande reçue par e-mail").slice(0, 300),
    description,
    // L'e-mail ne contient souvent qu'un extrait de l'annonce (Upwork) : « brouillon sur extrait ».
    description_truncated: platform === "upwork",
    budget_text: parsed.budget,
    categories: [],
    published_at: receivedAt,
    source: "email",
  };
}

export async function ingestPlatformEmail(deps: EmailIngestDeps, email: InboundEmail): Promise<EmailIngestResponse> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const db = deps.db;

  // 1. Dédoublonnage par message_id : un e-mail rejoué ne refait rien.
  const { data: known } = await db.from("opportunity_emails").select("id, platform, kind, status, opportunity_id, alerted").eq("user_id", deps.userId).eq("message_id", email.message_id).limit(1);
  const seen = (known ?? [])[0] as { platform: Platform | null; kind: EmailKind; status: string; opportunity_id: string | null; alerted: boolean } | undefined;
  if (seen) {
    return {
      ok: true,
      message_id: email.message_id,
      platform: seen.platform,
      kind: seen.kind,
      status: seen.status === "cree" || seen.status === "rattache" ? seen.status : "a_trier",
      opportunity_ids: seen.opportunity_id ? [seen.opportunity_id] : [],
      alerted: seen.alerted,
      orion_url: seen.opportunity_id ? orionUrl(deps.baseUrl, seen.opportunity_id) : null,
      duplicate: true,
    };
  }

  const parsed = parsePlatformEmail(email);
  const base = {
    user_id: deps.userId,
    message_id: email.message_id,
    platform: parsed.platform,
    kind: parsed.kind,
    from_address: email.from.slice(0, 300),
    subject: email.subject.slice(0, 500),
    received_at: email.received_at ?? now,
    excerpt: parsed.body.slice(0, 2000),
    external_id: parsed.externalId,
  };
  // L'e-mail est enregistré AVANT tout traitement : la clé unique (user_id, message_id) arbitre deux appels simultanés.
  const { data: inserted, error: insertError } = await db.from("opportunity_emails").insert({ ...base, status: "a_trier" }).select("id").single();
  if (insertError || !inserted) {
    return { ok: true, message_id: email.message_id, platform: parsed.platform, kind: parsed.kind, status: "a_trier", opportunity_ids: [], alerted: false, orion_url: null, duplicate: true };
  }
  const emailId = (inserted as { id: string }).id;
  const finish = async (patch: Record<string, unknown>) => {
    await db.from("opportunity_emails").update(patch).eq("id", emailId);
  };

  const platform = parsed.platform;
  // 2. Non reconnu (expéditeur inconnu, Codeur, ou type d'e-mail inconnu) : à trier, sans alerte.
  if (!platform || platform === "codeur" || platform === "autre" || parsed.kind === "autre") {
    return { ok: true, message_id: email.message_id, platform, kind: parsed.kind, status: "a_trier", opportunity_ids: [], alerted: false, orion_url: null };
  }

  const ingestDeps: IngestDeps = { ...deps, notify: undefined };

  // 3. Recommandations : une opportunité par annonce, analysées comme la veille, sans alerte.
  if (parsed.kind === "recommandation") {
    const ids: string[] = [];
    for (const job of parsed.jobs) {
      const result = await ingestOpportunity(ingestDeps, {
        platform,
        external_id: job.externalId ?? fallbackId(`${email.message_id}:${job.title}`),
        url: job.url,
        title: job.title,
        description: [job.snippet, job.budget ? `Budget : ${job.budget}` : null].filter(Boolean).join("\n\n"),
        description_truncated: true,
        budget_text: job.budget,
        categories: [],
        published_at: email.received_at,
        source: "email",
      });
      ids.push(result.id);
    }
    await finish({ status: ids.length ? "cree" : "a_trier", opportunity_id: ids[0] ?? null });
    return { ok: true, message_id: email.message_id, platform, kind: parsed.kind, status: ids.length ? "cree" : "a_trier", opportunity_ids: ids, alerted: false, orion_url: ids[0] ? orionUrl(deps.baseUrl, ids[0]) : null };
  }

  // 4. Suivi d'une opportunité existante (message, offre, mission confirmée, clôture… et invitation déjà connue).
  const existing = await findOpportunity(db, deps.userId, platform, parsed);
  const tracking = parsed.kind === "message" || parsed.kind === "offre" || parsed.kind === "gagnee" || parsed.kind === "perdue";
  if (existing && (tracking || parsed.kind === "invitation" || parsed.kind === "demande")) {
    const next = statusAfterEvent(existing.status, parsed.kind);
    const patch: Record<string, unknown> = { last_event_at: base.received_at, updated_at: now };
    if (next) Object.assign(patch, { status: next }, milestones(next, existing, base.received_at));
    if (parsed.clientName && !existing.client_name) patch.client_name = parsed.clientName;
    await db.from("opportunities").update(patch).eq("id", existing.id);
    const url = orionUrl(deps.baseUrl, existing.id);
    // Une invitation ou une demande reste une alerte, même sur une annonce déjà connue.
    const alerted = ALERT_KINDS.includes(parsed.kind) ? await sendAlert(deps, alertFor(platform, parsed.kind, parsed, url, null)) : false;
    await finish({ status: "rattache", opportunity_id: existing.id, alerted });
    return { ok: true, message_id: email.message_id, platform, kind: parsed.kind, status: "rattache", opportunity_ids: [existing.id], alerted, orion_url: url, opportunity_status: (next ?? existing.status) as OpportunityStatus };
  }

  // Mission confirmée ou clôture sans opportunité connue : à trier (rien à faire avancer).
  if (parsed.kind === "gagnee" || parsed.kind === "perdue") {
    return { ok: true, message_id: email.message_id, platform, kind: parsed.kind, status: "a_trier", opportunity_ids: [], alerted: false, orion_url: null };
  }

  // 5. Nouvelle opportunité. Un message sans opportunité connue : sur Malt et ComeUp, c'est un
  //    client qui vient vers Axel (nouvelle demande) ; sur Upwork, la réponse à une proposition
  //    envoyée sans passer par ORION (statut « Réponse »).
  const kind: EmailKind = parsed.kind === "message" && platform !== "upwork" ? "demande" : parsed.kind;
  const result = await ingestOpportunity(ingestDeps, asIngestBody(platform, parsed, email.message_id, email.received_at));
  const status: OpportunityStatus | null =
    kind === "commande" ? "gagnee" : kind === "offre" ? "entretien" : kind === "message" ? "reponse" : null;
  const patch: Record<string, unknown> = { last_event_at: base.received_at, updated_at: now };
  if (parsed.clientName) patch.client_name = parsed.clientName;
  if (status) Object.assign(patch, { status }, milestones(status, {}, base.received_at));
  if (kind === "commande" && parsed.amountEur != null) patch.amount_eur = parsed.amountEur;
  await db.from("opportunities").update(patch).eq("id", result.id);
  const url = orionUrl(deps.baseUrl, result.id);
  const scoreNote = result.filtered ? `Filtre : ${result.reasons[0] ?? "hors périmètre"}.` : result.score != null ? `Adéquation ${result.score}/10.` : null;
  const alerted = ALERT_KINDS.includes(kind) ? await sendAlert(deps, alertFor(platform, kind, parsed, url, scoreNote)) : false;
  await finish({ status: "cree", kind, opportunity_id: result.id, alerted });
  return { ok: true, message_id: email.message_id, platform, kind, status: "cree", opportunity_ids: [result.id], alerted, orion_url: url, ...(status ? { opportunity_status: status } : {}) };
}

async function sendAlert(deps: EmailIngestDeps, notification: Notification): Promise<boolean> {
  if (!deps.notify) return false;
  try {
    const sent = await deps.notify(notification);
    return sent !== false;
  } catch {
    return false;
  }
}
