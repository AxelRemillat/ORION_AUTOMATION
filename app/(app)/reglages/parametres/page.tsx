import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { signatureFor } from "@/lib/offer/model";
import { loadOffer } from "@/lib/offer/read";
import { createClient } from "@/lib/supabase/server";
import { loadCapacity } from "@/lib/today/capacity";
import { FunnelSettings } from "../../recherche/funnel/funnel-settings";
import { SendingCard } from "./sending-card";
import { NotificationsCard } from "./notifications-card";
import { notifyConfigured, readNotifyPrefs } from "@/lib/notify/ntfy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paramètres · Réglages · ORION" };

/**
 * Réglages › Paramètres : les réglages existants, regroupés. La préparation
 * quotidienne garde l'état de son interrupteur : rien n'est modifié tant que
 * l'utilisateur n'enregistre pas.
 */
export default async function ParametresPage() {
  const user = await requireUser();
  const db = createClient();
  const [capacity, loaded, notifyPrefs] = await Promise.all([loadCapacity(db, user.id), loadOffer(db, user.id), readNotifyPrefs(db, user.id)]);
  return (
    <>
      <PageHeader title="Paramètres" description="Préparation du matin, zones et secteurs, plafond d'envois, signature, notifications." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Préparation quotidienne et ciblage</CardTitle>
            <CardDescription>
              Run automatique du lundi au vendredi à l&apos;heure réglée (Paris) ; « Lancer maintenant » reste possible tous les jours depuis « Aujourd&apos;hui ».
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FunnelSettings />
          </CardContent>
        </Card>
        <SendingCard capacity={capacity} signature={signatureFor(loaded.offer)} entryUrl={loaded.offer.entry_url ?? null} />
        <NotificationsCard prefs={notifyPrefs} configured={notifyConfigured()} />
      </div>
    </>
  );
}
