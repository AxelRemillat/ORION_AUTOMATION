import { createHash } from "node:crypto";
import type { Notification } from "@/lib/notify/ntfy";
import { ingestOpportunity, type IngestBody, type IngestDeps, type IngestResponse, type Verdict } from "../ingest";
import { PLATFORM_LABELS, type OpportunityStatus, type Platform } from "../types";

export { milestones, statusAfterEvent };
import { milestones, statusAfterEvent } from "./milestones";
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

export type EmailIngestStatus = "cree" | "rattache" | "a_trier" | "doublon";

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
  /** Codeur « Nouveau projet » : verdict et score de l'analyse (mêmes valeurs que /ingest). */
  verdict?: Verdict;
  score?: number | null;
}

const orionUrl = (baseUrl: string, id: string) => `${baseUrl.replace(/\/$/, "")}/opportunites?id=${encodeURIComponent(id)}`;

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

function alertFor(platform: Platform, kind: EmailKind, parsed: ParsedEmail, url: string, extra: string | null, knownTitle?: string): Notification {
  const what = kind === "invitation" ? "Invitation" : kind === "commande" ? "Nouvelle commande" : kind === "gagnee" ? "Projet attribué" : kind === "message" ? "Message client" : "Nouvelle demande";
  const details = [parsed.clientName ? `Client : ${parsed.clientName}.` : null, parsed.budget ? `Budget : ${parsed.budget}.` : null, extra].filter(Boolean).join(" ");
  return {
    title: `${what} ${PLATFORM_LABELS[platform]} : ${knownTitle ?? parsed.title ?? "sans titre"}`,
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

/**
 * DÉCISION pour un e-mail analysé (code pur, partagé par l'ingestion et le mode
 * test `dry_run`) : à trier, recommandations, suivi d'une fiche existante, ou
 * nouvelle fiche — avec le type retenu, le statut visé et l'alerte.
 */
export type EmailDecision =
  | { action: "a_trier"; kind: EmailKind; reason: string }
  | { action: "recommandations"; kind: "recommandation"; jobs: number }
  | { action: "rattache"; kind: EmailKind; opportunityId: string; status: OpportunityStatus; statusChanged: boolean; alert: boolean }
  | { action: "cree"; kind: EmailKind; status: OpportunityStatus | null; alert: boolean }
  /** Codeur « Nouveau projet » déjà connu par le flux RSS : rien d'écrit, aucune alerte. */
  | { action: "doublon"; kind: "nouveau_projet"; opportunityId: string };

/** Codeur : alerte pour un message du client ou un projet attribué. */
export const CODEUR_ALERT_KINDS: readonly EmailKind[] = ["message", "gagnee"];

export function decideEmail(parsed: ParsedEmail, existing: (Pick<OpportunityRow, "id" | "status"> & Partial<Pick<OpportunityRow, "external_id">>) | null): EmailDecision {
  const platform = parsed.platform;
  if (!platform || platform === "autre") return { action: "a_trier", kind: parsed.kind, reason: "expéditeur inconnu" };
  if (parsed.kind === "autre") return { action: "a_trier", kind: "autre", reason: "type d'e-mail non reconnu" };
  // Codeur (plateformes #6) : SUIVI d'un projet déjà connu par le flux RSS, jamais de création.
  // Alerte pour un message client ou une attribution ; refus et clôture passent en « Perdue » sans alerte.
  if (platform === "codeur") {
    // « Nouveau projet » (plateformes #7) : filet de sécurité du flux RSS. Projet déjà connu (même
    // identifiant, jamais le titre) → doublon ; inconnu → créé par le chemin de /ingest (analyse et seuil d'alerte).
    if (parsed.kind === "nouveau_projet") {
      if (!parsed.externalId) return { action: "a_trier", kind: "nouveau_projet", reason: "Codeur : aucun identifiant de projet dans l'e-mail" };
      if (existing && existing.external_id === parsed.externalId) return { action: "doublon", kind: "nouveau_projet", opportunityId: existing.id };
      return { action: "cree", kind: "nouveau_projet", status: null, alert: false };
    }
    if (!existing) return { action: "a_trier", kind: parsed.kind, reason: parsed.externalId ? `Codeur : projet ${parsed.externalId} inconnu d'ORION` : "Codeur : aucun identifiant de projet dans l'e-mail" };
    const next = statusAfterEvent(existing.status, parsed.kind);
    return { action: "rattache", kind: parsed.kind, opportunityId: existing.id, status: next ?? existing.status, statusChanged: Boolean(next), alert: CODEUR_ALERT_KINDS.includes(parsed.kind) };
  }
  if (parsed.kind === "recommandation") return { action: "recommandations", kind: "recommandation", jobs: parsed.jobs.length };
  const tracking = parsed.kind === "message" || parsed.kind === "offre" || parsed.kind === "gagnee" || parsed.kind === "perdue";
  if (existing && (tracking || parsed.kind === "invitation" || parsed.kind === "demande")) {
    const next = statusAfterEvent(existing.status, parsed.kind);
    // Une invitation ou une demande reste une alerte, même sur une annonce déjà connue.
    return { action: "rattache", kind: parsed.kind, opportunityId: existing.id, status: next ?? existing.status, statusChanged: Boolean(next), alert: ALERT_KINDS.includes(parsed.kind) };
  }
  // Mission confirmée ou clôture sans opportunité connue : à trier (rien à faire avancer).
  if (parsed.kind === "gagnee" || parsed.kind === "perdue") return { action: "a_trier", kind: parsed.kind, reason: "aucune fiche à faire avancer" };
  // Un message sans opportunité connue : sur Malt et ComeUp, c'est un client qui vient vers Axel
  // (nouvelle demande) ; sur Upwork, la réponse à une proposition envoyée hors ORION (« Réponse »).
  const kind: EmailKind = parsed.kind === "message" && platform !== "upwork" ? "demande" : parsed.kind;
  const status: OpportunityStatus | null = kind === "commande" ? "gagnee" : kind === "offre" ? "entretien" : kind === "message" ? "reponse" : null;
  return { action: "cree", kind, status, alert: ALERT_KINDS.includes(kind) };
}

/** Réponse du mode test (`dry_run: true`) : ce qui SERAIT fait, rien d'écrit, aucune alerte, aucun appel au modèle. */
export interface EmailDryRunResponse {
  ok: true;
  dry_run: true;
  message_id: string;
  duplicate: boolean;
  platform: Platform | null;
  kind: EmailKind;
  /** cree · rattache · a_trier · recommandations · doublon */
  action: EmailDecision["action"];
  reason: string | null;
  /** Statut que prendrait la fiche (`null` : celui de l'analyse). */
  opportunity_status: OpportunityStatus | null;
  would_alert: boolean;
  /** Fiche visée (suivi) ou déjà liée (doublon). */
  target: { id: string; title: string; status: OpportunityStatus; orion_url: string } | null;
  parsed: { title: string | null; url: string | null; external_id: string | null; client_name: string | null; budget: string | null; amount_eur: number | null; jobs: { title: string; url: string | null }[] };
}

/** MODE TEST : analyse complète, en lecture seule (Cowork teste le workflow n8n sans créer de fausses fiches). */
export async function planPlatformEmail(deps: Pick<EmailIngestDeps, "db" | "userId" | "baseUrl">, email: InboundEmail): Promise<EmailDryRunResponse> {
  const parsed = parsePlatformEmail(email);
  const summary = {
    title: parsed.title,
    url: parsed.url,
    external_id: parsed.externalId,
    client_name: parsed.clientName,
    budget: parsed.budget,
    amount_eur: parsed.amountEur,
    jobs: parsed.jobs.map((job) => ({ title: job.title, url: job.url })),
  };
  const { data: known } = await deps.db.from("opportunity_emails").select("id, opportunity_id").eq("user_id", deps.userId).eq("message_id", email.message_id).limit(1);
  const seen = (known ?? [])[0] as { opportunity_id: string | null } | undefined;
  const targetOf = async (id: string | null) => {
    if (!id) return null;
    const { data } = await deps.db.from("opportunities").select("id, title, status").eq("id", id).maybeSingle();
    const row = data as { id: string; title: string; status: OpportunityStatus } | null;
    return row ? { ...row, orion_url: orionUrl(deps.baseUrl, row.id) } : null;
  };
  if (seen) {
    return { ok: true, dry_run: true, message_id: email.message_id, duplicate: true, platform: parsed.platform, kind: parsed.kind, action: "doublon", reason: "message_id déjà reçu : rien ne serait refait", opportunity_status: null, would_alert: false, target: await targetOf(seen.opportunity_id), parsed: summary };
  }
  const usable = parsed.platform && parsed.platform !== "autre";
  const existing = usable ? await findOpportunity(deps.db, deps.userId, parsed.platform as Platform, parsed) : null;
  const decision = decideEmail(parsed, existing);
  return {
    ok: true,
    dry_run: true,
    message_id: email.message_id,
    duplicate: false,
    platform: parsed.platform,
    kind: decision.kind,
    action: decision.action,
    reason:
      decision.action === "a_trier"
        ? decision.reason
        : decision.action === "doublon"
          ? "projet déjà connu par le flux RSS : rien ne serait écrit"
          : decision.kind === "nouveau_projet"
            ? "nouveau projet inconnu : même chemin que /ingest (filtre, analyse) ; alerte si le score atteint 8"
            : null,
    opportunity_status: decision.action === "rattache" || decision.action === "cree" ? decision.status : null,
    would_alert: decision.action === "rattache" || decision.action === "cree" ? decision.alert : false,
    target: (decision.action === "rattache" || decision.action === "doublon") && existing ? { id: existing.id, title: existing.title, status: existing.status, orion_url: orionUrl(deps.baseUrl, existing.id) } : null,
    parsed: summary,
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
  const platform = parsed.platform;
  const usable = platform && platform !== "autre";
  const existing = usable && parsed.kind !== "recommandation" && parsed.kind !== "autre" ? await findOpportunity(db, deps.userId, platform as Platform, parsed) : null;
  const decision = decideEmail(parsed, existing);

  // Codeur « Nouveau projet » déjà connu par le flux RSS : RIEN d'écrit (pas même l'e-mail), aucune alerte.
  if (decision.action === "doublon") {
    return { ok: true, message_id: email.message_id, platform, kind: decision.kind, status: "doublon", opportunity_ids: [decision.opportunityId], alerted: false, orion_url: orionUrl(deps.baseUrl, decision.opportunityId), duplicate: true };
  }

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

  // 2. Non reconnu (expéditeur inconnu, Codeur, type inconnu, clôture sans fiche) : à trier, sans alerte.
  if (decision.action === "a_trier" || !platform) {
    return { ok: true, message_id: email.message_id, platform, kind: parsed.kind, status: "a_trier", opportunity_ids: [], alerted: false, orion_url: null };
  }

  const ingestDeps: IngestDeps = { ...deps, notify: undefined };

  // 3. Recommandations : une opportunité par annonce, analysées comme la veille, sans alerte.
  if (decision.action === "recommandations") {
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
  if (decision.action === "rattache" && existing) {
    const patch: Record<string, unknown> = { last_event_at: base.received_at, updated_at: now };
    if (decision.statusChanged) Object.assign(patch, { status: decision.status }, milestones(decision.status, existing, base.received_at));
    if (parsed.clientName && !existing.client_name) patch.client_name = parsed.clientName;
    await db.from("opportunities").update(patch).eq("id", existing.id);
    const url = orionUrl(deps.baseUrl, existing.id);
    const alerted = decision.alert ? await sendAlert(deps, alertFor(platform, parsed.kind, parsed, url, null, existing.title)) : false;
    await finish({ status: "rattache", opportunity_id: existing.id, alerted });
    return { ok: true, message_id: email.message_id, platform, kind: parsed.kind, status: "rattache", opportunity_ids: [existing.id], alerted, orion_url: url, opportunity_status: decision.status };
  }

  // 5a. Codeur « Nouveau projet » inconnu : EXACTEMENT le chemin de /api/opportunities/ingest
  //     (pré-filtre, plafond, analyse, proposition, alerte de quota) ; titre et extrait de l'e-mail
  //     comme annonce. Alerte au même seuil que la veille RSS : verdict « alerte » (score ≥ 8).
  if (decision.action === "cree" && decision.kind === "nouveau_projet") {
    const result = await ingestOpportunity({ ...deps }, codeurProjectBody(parsed, email.received_at));
    const url = orionUrl(deps.baseUrl, result.id);
    const alerted = result.verdict === "alerte" && !result.duplicate ? await sendAlert(deps, projectAlert(parsed, result, url)) : false;
    await finish({ status: result.duplicate ? "rattache" : "cree", opportunity_id: result.id, alerted });
    return { ok: true, message_id: email.message_id, platform, kind: "nouveau_projet", status: result.duplicate ? "rattache" : "cree", opportunity_ids: [result.id], alerted, orion_url: url, verdict: result.verdict, score: result.score };
  }

  // 5. Nouvelle opportunité.
  const { kind, status } = decision as Extract<EmailDecision, { action: "cree" }>;
  const result = await ingestOpportunity(ingestDeps, asIngestBody(platform, parsed, email.message_id, email.received_at));
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

/** Lignes standard de l'alerte Codeur (pas du contenu d'annonce). */
const CODEUR_BOILERPLATE = /^(un projet dans vos comp[ée]tences|nouveau projet publi[ée]|d[ée]poser une offre|codeur\.com|projet\s*:|budget\s*:|cordialement|l[’']?[ée]quipe codeur)/i;

/**
 * Texte d'annonce d'une alerte Codeur « Nouveau projet » : ce qui reste une fois
 * retirés liens et lignes standard ; à défaut (l'alerte ne donne souvent que le
 * titre), le titre seul. Jamais le pied de page : il faussait le pré-filtre.
 */
export function codeurProjectDescription(body: string, title: string): string {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !CODEUR_BOILERPLATE.test(line) && line !== title);
  return lines.join("\n").trim() || title;
}

/** Codeur « Nouveau projet » : l'annonce telle que l'e-mail la donne (titre, extrait), comme un item du flux. */
function codeurProjectBody(parsed: ParsedEmail, receivedAt: string | null): IngestBody {
  const title = (parsed.title ?? "Nouveau projet Codeur").slice(0, 300);
  return {
    platform: "codeur",
    external_id: parsed.externalId as string,
    url: parsed.url,
    title,
    description: codeurProjectDescription(parsed.body, title).slice(0, 20_000),
    // L'alerte ne donne que le titre : pré-filtre sur le titre, puis « À voir » sans analyse.
    titleOnly: codeurProjectDescription(parsed.body, title) === title,
    description_truncated: true,
    budget_text: parsed.budget,
    categories: [],
    published_at: receivedAt,
    source: "email",
  };
}

function projectAlert(parsed: ParsedEmail, result: IngestResponse, url: string): Notification {
  return codeurProjectAlert({ title: result.title, score: result.score, reasons: result.reasons, budget: parsed.budget }, url);
}

/** Alerte « Nouvelle offre Codeur » (ingestion par e-mail et rattrapage : même format). */
export function codeurProjectAlert(item: { title: string; score: number | null; reasons: readonly string[]; budget: string | null }, url: string, note = "Reçue par e-mail (absente du flux RSS)."): Notification {
  return {
    title: `Nouvelle offre Codeur (${item.score ?? "?"}/10) : ${item.title}`,
    body: [item.reasons.slice(0, 3).join(" · "), item.budget ? `Budget : ${item.budget}.` : null, note].filter(Boolean).join(" "),
    priority: "high",
    tags: ["briefcase"],
    click: url,
  };
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
