import type { Db } from "@/lib/trash/scope";
import type { InboundMessage, Prospect } from "@/types";
import { LAUNCH_FRESH_DAYS, laneOf } from "@/lib/opportunities/lane";
import { purgeCutoff } from "@/lib/trash/retention";
import { unreadBadgeCount } from "@/lib/inbound/read-state";

/**
 * LES BADGES DE LA BARRE — une seule source, trois règles écrites.
 *
 * Avant (Cowork #21) ils ne voulaient plus rien dire : « Opportunités 2 » alors
 * qu'Axel avait tout vu et répondu, un compteur de corbeille qui comptait des
 * éléments déjà expirés, et des valeurs figées jusqu'au rechargement complet
 * de la page. Chaque règle est donc posée ici, et nulle part ailleurs.
 *
 *   OPPORTUNITÉS — une annonce compte si elle est NON VUE (`seen_at` vide) ET
 *     encore À TRAITER (statut `a_repondre`) ET FRAÎCHE (7 jours). Marquée
 *     « Vu », envoyée, ignorée, fermée, ou plus vieille que 7 jours : elle ne
 *     compte plus. Deux familles d'alerte, celle du score (≥ 8) et les
 *     missions de lancement Codeur (calculées sur le texte, quel que soit le
 *     score) ; une annonce vue par les deux n'est comptée qu'une fois.
 *   BOÎTE MAIL — mails reçus vivants et NON LUS, hors absences et hors
 *     anti-spams déjà validés (lib/inbound/read-state).
 *   CORBEILLE — prospects, mails envoyés et mails reçus à la corbeille, DANS
 *     la fenêtre de rétention : exactement ce que /corbeille affiche après sa
 *     purge. Les SIREN exclus n'y sont pas, ce n'est pas une suppression.
 */

export interface BadgeCounts {
  /** Alertes Opportunités non vues et non traitées. */
  alerts: number;
  /** Mails reçus non lus qui demandent une action. */
  unread: number;
  /** Éléments réellement à la corbeille. */
  trash: number;
}

export const ZERO_BADGES: BadgeCounts = { alerts: 0, unread: 0, trash: 0 };

type Row = Record<string, unknown>;
type Loose = { from: (table: string) => any };

/** Une annonce ne compte que tant qu'elle est jeune : au-delà, ce n'est plus une alerte. */
const freshSince = (now: Date) => new Date(now.getTime() - LAUNCH_FRESH_DAYS * 86_400_000).toISOString();

/**
 * Alertes Opportunités. Les colonnes `seen_at` / `fit_score` peuvent manquer
 * sur une base pas encore migrée : l'échec d'une requête vaut 0, jamais une
 * page en erreur.
 */
async function alertCount(db: Db, now: Date): Promise<number> {
  const loose = db as unknown as Loose;
  const since = freshSince(now);
  const { data } = await loose
    .from("opportunities")
    .select("id, platform, title, body, budget, categories, published_at, created_at, fit_score")
    .eq("status", "a_repondre")
    .is("seen_at", null)
    .is("filter_reason", null)
    .limit(300)
    .then((result: { data: Row[] | null }) => result, () => ({ data: null }));

  const ids = new Set<string>();
  for (const row of (data ?? []) as Row[]) {
    const published = (row.published_at as string | null) ?? (row.created_at as string | null) ?? null;
    if (published && published < since) continue;
    const score = (row.fit_score as number | null) ?? 0;
    // Score élevé, ou mission de lancement Codeur reconnue sur le texte.
    if (score >= 8 || ["lancement", "regie"].includes(laneOf(row as never, now) ?? "")) ids.add(row.id as string);
  }
  return ids.size;
}

/**
 * Mails reçus non lus. Seules les lignes NON LUES sont chargées, et seules les
 * fiches de ces mails-là : la validation anti-spam vit sur la fiche.
 */
async function unreadCount(db: Db): Promise<number> {
  const loose = db as unknown as Loose;
  const { data: inbound } = await loose
    .from("inbound_messages")
    .select("id, prospect_id, from_email, subject, body, read_at, deleted_at")
    .is("read_at", null)
    .is("deleted_at", null)
    .limit(300)
    .then((result: { data: Row[] | null }) => result, () => ({ data: null }));
  const rows = (inbound ?? []) as Row[];
  if (!rows.length) return 0;

  const prospectIds = [...new Set(rows.map((row) => row.prospect_id).filter((id): id is string => typeof id === "string"))];
  const { data: prospects } = prospectIds.length
    ? await loose
        .from("prospects")
        .select("id, key_figures")
        .in("id", prospectIds)
        .then((result: { data: Row[] | null }) => result, () => ({ data: null }))
    : { data: [] as Row[] };

  return unreadBadgeCount(
    rows as unknown as InboundMessage[],
    (prospects ?? []) as unknown as Pick<Prospect, "id" | "key_figures">[],
  );
}

/** Corbeille : les trois tables, fenêtre de rétention comprise. */
async function trashTotal(db: Db, now: Date): Promise<number> {
  const loose = db as unknown as Loose;
  const cutoff = purgeCutoff(now);
  const counts = await Promise.all(
    ["prospects", "messages", "inbound_messages"].map((table) =>
      loose
        .from(table)
        .select("id", { count: "exact", head: true })
        .not("deleted_at", "is", null)
        .gte("deleted_at", cutoff)
        .then((result: { count: number | null }) => result.count ?? 0, () => 0),
    ),
  );
  return counts.reduce((total, count) => total + count, 0);
}

/** Les trois badges, recalculés à chaque appel — aucune valeur mise en cache. */
export async function badgeCounts(db: Db, now = new Date()): Promise<BadgeCounts> {
  const [alerts, unread, trash] = await Promise.all([alertCount(db, now), unreadCount(db), trashTotal(db, now)]);
  return { alerts, unread, trash };
}
