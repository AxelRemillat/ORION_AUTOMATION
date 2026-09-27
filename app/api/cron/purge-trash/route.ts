import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { authorizeCron } from "@/lib/trash/cron-auth";
import { purgeExpired } from "@/lib/trash/operations";
import { purgeExpiredMessages } from "@/lib/outbox/trash";
import { purgeExpiredInbound } from "@/lib/outbox/inbound-trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Purge quotidienne de la corbeille (vercel.json → crons).
 *
 * Supprime définitivement, pour TOUS les comptes (client service_role), les
 * prospects à la corbeille depuis plus de 14 jours, avec leurs données liées,
 * et exclut leur SIREN de la recherche ; puis les MAILS à la corbeille depuis
 * plus de 14 jours (lib/outbox/trash.ts). Idempotente : relancée, elle ne
 * purge que ce qui reste à purger.
 */
export async function GET(request: Request) {
  if (!authorizeCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = await purgeExpired(admin);
  // Les mails d'abord purgés avec leur prospect (cascade) ; ceux-ci sont les
  // mails mis seuls à la corbeille.
  const mails = await purgeExpiredMessages(admin);
  const received = await purgeExpiredInbound(admin);
  const failure = !result.ok
    ? result.error
    : !mails.ok
      ? `mails : ${mails.error}`
      : !received.ok
        ? `mails reçus : ${received.error}`
        : null;
  if (failure) {
    console.error(`[purge-trash] échec : ${failure}`);
    return NextResponse.json({ ok: false, error: failure }, { status: 500 });
  }
  const purged = result.ok ? result.count : 0;
  const purgedMessages = mails.ok ? mails.count : 0;
  const purgedInbound = received.ok ? received.count : 0;
  console.log(
    `[purge-trash] ${purged} prospect(s), ${purgedMessages} mail(s) envoyé(s)/brouillon(s) et ${purgedInbound} mail(s) reçu(s) supprimé(s) définitivement`,
  );
  return NextResponse.json({ ok: true, purged, purgedMessages, purgedInbound });
}
