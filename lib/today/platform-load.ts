import { messagesToAnswer, followUpsToSend, type InboundExcerpt, type PlatformTask } from "./platform";
import type { Db } from "@/lib/trash/scope";

/**
 * Lecture des conversations de plateforme pour « Aujourd'hui » (Cowork #17).
 *
 * Deux requêtes, aucune écriture : les fiches dont la balle est dans notre camp
 * (statut « Réponse ») et celles dont la relance est due. Le tri et les règles
 * sont dans `platform.ts`, qui est pur et testé sur fixtures ; ici on ne fait
 * que lire.
 *
 * Les extraits viennent de `opportunity_emails` quand l'e-mail de notification
 * en porte un. Codeur n'en met pas : la vue le dit au lieu d'inventer.
 */
const COLUMNS =
  "id, platform, status, title, url, sent_at, replied_at, proposal, language, followed_up_at, conversation_at, follow_up_text";

export async function loadPlatformTasks(db: Db, userId: string, now = new Date()): Promise<PlatformTask[]> {
  const { data } = await db
    .from("opportunities")
    .select(COLUMNS)
    .eq("user_id", userId)
    .in("status", ["reponse", "envoyee"])
    .limit(500);
  const rows = (data ?? []) as never[];
  if (rows.length === 0) return [];

  // Extraits des e-mails « message » déjà rattachés à une fiche.
  const { data: mails } = await db
    .from("opportunity_emails")
    .select("opportunity_id, received_at, excerpt")
    .eq("user_id", userId)
    .eq("kind", "message")
    .not("opportunity_id", "is", null)
    .order("received_at", { ascending: false })
    .limit(200);
  const inbound: InboundExcerpt[] = ((mails ?? []) as { opportunity_id: string; received_at: string; excerpt: string | null }[]).map(
    (row) => ({ opportunityId: row.opportunity_id, receivedAt: row.received_at, excerpt: row.excerpt }),
  );

  // Les messages d'abord : une réponse d'un client passe avant une relance.
  return [...messagesToAnswer(rows, inbound), ...followUpsToSend(rows, now)];
}
