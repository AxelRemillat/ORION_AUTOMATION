import type { Db } from "@/lib/trash/scope";

/**
 * Notifications téléphone via ntfy (https://ntfy.sh) — Axel ne consulte pas
 * Gmail, ORION le prévient tout de suite.
 *
 *   - `NTFY_TOPIC` absent : rien n'est fait. Le topic n'est JAMAIS loggué ni
 *     affiché (c'est le seul « secret » d'un topic ntfy).
 *   - Un échec d'envoi est silencieux (un log, sans le topic) : il ne bloque
 *     jamais la réception d'un mail ni le tick d'envoi.
 *   - Anti-doublon : une notification par message (`notification_log`, clé
 *     primaire « <type>:<id du message> »).
 *   - Interrupteurs par type dans Réglages › Paramètres (`notification_prefs`).
 */

export type NotifyKind = "reply" | "antispam" | "send_failed";
export type NotifyPriority = "urgent" | "high" | "default" | "low" | "min";

export interface NotifyPrefs {
  reply: boolean;
  antispam: boolean;
  send_failed: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { reply: true, antispam: true, send_failed: true };

export interface Notification {
  title: string;
  body: string;
  priority: NotifyPriority;
  tags: string[];
  /** Lien ouvert au toucher de la notification (fiche ORION). */
  click: string | null;
}

export interface NotifyDeps {
  /** Par défaut `process.env.NTFY_TOPIC`. */
  topic?: string | null;
  fetch?: typeof fetch;
  /** Par défaut `ORION_PUBLIC_URL`, `JOBS_BASE_URL`, puis l'adresse de prod. */
  baseUrl?: string;
}

export type NotifyOutcome = { sent: true } | { sent: false; reason: "no-topic" | "disabled" | "duplicate" | "error" };

const NTFY = "https://ntfy.sh";
const TIMEOUT_MS = 5000;

/** Un topic est configuré (sans jamais en exposer la valeur). */
export function notifyConfigured(deps: NotifyDeps = {}): boolean {
  return Boolean((deps.topic === undefined ? process.env.NTFY_TOPIC : deps.topic)?.trim());
}

export function appUrl(deps: NotifyDeps = {}): string {
  const base = deps.baseUrl ?? (process.env.ORION_PUBLIC_URL?.trim() || process.env.JOBS_BASE_URL?.trim() || "https://orion.axelremillat.com");
  return base.replace(/\/+$/, "");
}

/** En-tête HTTP : ASCII seulement (accents retirés), une ligne, 120 caractères au plus. */
export function asciiTitle(text: string, max = 120): string {
  const ascii = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/«\s*/g, '"')
    .replace(/\s*»/g, '"')
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return ascii.length > max ? `${ascii.slice(0, max - 3).trimEnd()}...` : ascii;
}

const QUOTE_START = /^(?:le .{3,80} a écrit\s*:|on .{3,80} wrote\s*:|-{2,}\s*(?:original message|message d'origine)|de\s*:.+@|from\s*:.+@)/i;
const GREETING = /^(?:bonjour|bonsoir|hello|salut|hi|cher|chère|madame|monsieur)\b[^.!?\n]{0,40}[,!.]?$/i;

/** Première phrase d'une réponse (sans salutation ni historique cité), 140 caractères au plus. */
export function firstSentence(body: string, max = 140): string {
  const lines: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (QUOTE_START.test(line)) break;
    if (!line || line.startsWith(">")) continue;
    lines.push(line);
  }
  if (lines.length > 1 && GREETING.test(lines[0])) lines.shift();
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  const sentence = /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export async function readNotifyPrefs(db: Db, userId: string): Promise<NotifyPrefs> {
  try {
    const { data } = await db.from("notification_prefs").select("reply, antispam, send_failed").eq("user_id", userId).maybeSingle();
    const row = data as Partial<NotifyPrefs> | null;
    return {
      reply: row?.reply ?? DEFAULT_NOTIFY_PREFS.reply,
      antispam: row?.antispam ?? DEFAULT_NOTIFY_PREFS.antispam,
      send_failed: row?.send_failed ?? DEFAULT_NOTIFY_PREFS.send_failed,
    };
  } catch {
    return DEFAULT_NOTIFY_PREFS;
  }
}

/** Envoi brut vers ntfy. Jamais d'exception ; le topic n'apparaît dans aucun log. */
export async function pushNtfy(notification: Notification, deps: NotifyDeps = {}): Promise<boolean> {
  const topic = (deps.topic === undefined ? process.env.NTFY_TOPIC : deps.topic)?.trim();
  if (!topic) return false;
  const headers: Record<string, string> = {
    Title: asciiTitle(notification.title),
    Priority: notification.priority,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (notification.tags.length) headers.Tags = notification.tags.join(",");
  if (notification.click) headers.Click = notification.click;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await (deps.fetch ?? fetch)(`${NTFY}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: notification.body,
      signal: controller.signal,
    });
    if (!response.ok) console.warn(`[ntfy] notification refusée (HTTP ${response.status})`);
    return response.ok;
  } catch (error) {
    console.warn(`[ntfy] notification non envoyée : ${error instanceof Error ? error.name : "erreur"}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Notification d'un événement ORION : interrupteur du type, anti-doublon par
 * message, puis envoi. Ne lève jamais.
 */
export async function notifyEvent(
  db: Db,
  input: { userId: string; kind: NotifyKind; messageId: string; notification: Notification },
  deps: NotifyDeps = {},
): Promise<NotifyOutcome> {
  try {
    const topic = deps.topic === undefined ? process.env.NTFY_TOPIC : deps.topic;
    if (!topic?.trim()) return { sent: false, reason: "no-topic" };
    const prefs = await readNotifyPrefs(db, input.userId);
    if (!prefs[input.kind]) return { sent: false, reason: "disabled" };
    const { error } = await db.from("notification_log").insert({ key: `${input.kind}:${input.messageId}`, user_id: input.userId, kind: input.kind });
    // 23505 : déjà notifié. Autre erreur (table pas encore migrée…) : on prévient quand même.
    if ((error as { code?: string } | null)?.code === "23505") return { sent: false, reason: "duplicate" };
    const sent = await pushNtfy(input.notification, { ...deps, topic });
    return sent ? { sent: true } : { sent: false, reason: "error" };
  } catch {
    return { sent: false, reason: "error" };
  }
}
