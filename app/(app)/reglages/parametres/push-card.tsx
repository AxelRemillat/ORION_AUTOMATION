"use client";

import { useEffect, useState, useTransition } from "react";
import { BellOff, BellRing, MonitorSmartphone } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from "@/components/ui";
import { subscribePush, testPush, unsubscribePush, type BrowserSubscription } from "@/lib/push/actions";
import { currentSubscription, enablePush, pushSupported } from "./push-browser";

type State = "loading" | "unsupported" | "off" | "on" | "blocked";

/**
 * Notifications sur le PC (Web Push, Cowork #28) : une réponse de prospect,
 * une offre en Alerte — même onglet ORION fermé, tant que le navigateur tourne.
 * Clés VAPID absentes : « Notifications non configurées », rien d'autre.
 */
export function PushCard({ publicKey }: { publicKey: string | null }) {
  const toast = useToast();
  const [state, setState] = useState<State>("loading");
  const [busy, startBusy] = useTransition();

  useEffect(() => {
    if (!pushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("blocked");
    void currentSubscription()
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  function enable() {
    if (!publicKey) return;
    startBusy(async () => {
      try {
        const subscription = await enablePush(publicKey);
        const result = await subscribePush(subscription.toJSON() as BrowserSubscription, navigator.userAgent);
        if (!result.ok) throw new Error(result.error);
        setState("on");
        toast.success("Notifications activées sur cet appareil.");
      } catch (error) {
        if (Notification.permission === "denied") setState("blocked");
        toast.error(error instanceof Error ? error.message : "Activation impossible.");
      }
    });
  }

  function disable() {
    startBusy(async () => {
      const subscription = await currentSubscription().catch(() => null);
      if (subscription) {
        await unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe().catch(() => false);
      }
      setState("off");
      toast.success("Notifications désactivées sur cet appareil.");
    });
  }

  function test() {
    startBusy(async () => {
      const result = await testPush();
      if (result.ok) toast.success("Notification de test envoyée : regardez le coin de l'écran.");
      else toast.error(result.error);
    });
  }

  const status = !publicKey
    ? "Notifications non configurées : les clés VAPID manquent sur ce déploiement."
    : {
        loading: "Vérification de cet appareil…",
        unsupported: "Ce navigateur ne gère pas les notifications Web Push.",
        blocked: "Notifications bloquées pour ORION : autorisez-les dans les réglages du site, puis réessayez.",
        off: "Désactivées sur cet appareil.",
        on: "Activées sur cet appareil.",
      }[state];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications sur cet appareil</CardTitle>
        <CardDescription>
          Sur le PC, sans ouvrir ORION : une vraie réponse de prospect, ou une offre Codeur, Upwork ou ComeUp qui passe en Alerte. Rien d&apos;autre. Cliquer ouvre la fiche, le mail ou l&apos;offre.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className={`text-[13px] ${publicKey && state === "on" ? "text-good-ink" : publicKey && state !== "blocked" ? "text-muted" : "text-warn-ink"}`}>{status}</p>
        <div className="flex flex-wrap gap-2">
          {state === "on" ? (
            <>
              <Button variant="outline" size="sm" onClick={test} loading={busy} disabled={!publicKey}>
                <BellRing className="h-4 w-4" aria-hidden />
                Tester
              </Button>
              <Button variant="ghost" size="sm" onClick={disable} disabled={busy}>
                <BellOff className="h-4 w-4" aria-hidden />
                Désactiver
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={enable} loading={busy} disabled={!publicKey || state === "unsupported" || state === "loading"}>
              <MonitorSmartphone className="h-4 w-4" aria-hidden />
              {publicKey ? "Activer les notifications sur cet appareil" : "Notifications non configurées"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
