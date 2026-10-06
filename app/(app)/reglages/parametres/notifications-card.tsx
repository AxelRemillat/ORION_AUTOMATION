"use client";

import { useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, useToast } from "@/components/ui";
import { saveNotifyPrefs, sendTestNotification } from "@/lib/notify/actions";
import type { NotifyKind, NotifyPrefs } from "@/lib/notify/ntfy";

const TYPES: { key: NotifyKind; label: string; hint: string }[] = [
  { key: "reply", label: "Réponse d'un prospect", hint: "Priorité urgente, avec la première phrase. Jamais pour un anti-spam ou une absence." },
  { key: "antispam", label: "Anti-spam à valider", hint: "Challenge Mailinblack et consorts : le mail attend ta validation." },
  { key: "send_failed", label: "Envoi échoué", hint: "Un mail programmé n'est pas parti (après ses reprises)." },
];

/**
 * Notifications téléphone (ntfy) : un interrupteur par type, et un envoi de
 * test. Le topic NTFY_TOPIC ne s'affiche jamais : seulement « configuré » ou non.
 */
export function NotificationsCard({ prefs, configured }: { prefs: NotifyPrefs; configured: boolean }) {
  const toast = useToast();
  const [state, setState] = useState(prefs);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  function toggle(key: NotifyKind, value: boolean) {
    const next = { ...state, [key]: value };
    setState(next);
    startSave(async () => {
      const result = await saveNotifyPrefs(next);
      if (!result.ok) {
        setState(state);
        toast.error(result.error);
      }
    });
  }

  function test() {
    startTest(async () => {
      const result = await sendTestNotification();
      if (result.ok) toast.success("Notification de test envoyée : regarde ton téléphone.");
      else toast.error(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications téléphone</CardTitle>
        <CardDescription>
          Prévenu tout de suite sur l&apos;application ntfy, sans ouvrir Gmail. Toucher la notification ouvre la fiche dans ORION.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className={`text-[13px] ${configured ? "text-good-ink" : "text-warn-ink"}`}>
          {configured ? "Canal ntfy configuré sur ce déploiement." : "NTFY_TOPIC absent sur ce déploiement : aucune notification ne part."}
        </p>
        <ul className="flex flex-col gap-3">
          {TYPES.map((type) => (
            <li key={type.key}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={state[type.key]}
                  disabled={saving}
                  onChange={(event) => toggle(type.key, event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[rgb(var(--rgb-primary))]"
                />
                <span>
                  <span className="block text-[13px] font-medium text-text">{type.label}</span>
                  <span className="block text-[12px] text-muted">{type.hint}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="self-start" onClick={test} loading={testing} disabled={!configured}>
          <BellRing className="h-4 w-4" aria-hidden />
          Envoyer une notification de test
        </Button>
      </CardContent>
    </Card>
  );
}
