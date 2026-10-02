"use client";

import { useState } from "react";
import { Phone, Sparkles } from "lucide-react";
import { Button, Input, Label, useToast } from "@/components/ui";
import { completionLabel } from "@/lib/today/tags";
import type { TodayItem } from "@/lib/today/types";
import { completeToday, setTodayContact } from "../actions";

/**
 * Fiche « À compléter » : ce qui manque, ce qu'ORION a déjà tenté, et deux
 * issues — « Compléter avec ORION » (site → Linkup → Hunter dans le budget)
 * ou la saisie directe de l'email ou du site. Le téléphone s'affiche quand
 * l'email reste introuvable : un appel vaut mieux qu'une fiche morte.
 */
export function CompletionPanel({ item, onDone }: { item: TodayItem; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(item.contact.email ?? "");
  const [website, setWebsite] = useState(item.website ?? "");
  const [busy, setBusy] = useState<"orion" | "save" | null>(null);
  if (!item.prospectId) return null;
  const prospectId = item.prospectId;

  async function complete() {
    setBusy("orion");
    const result = await completeToday({ prospectId, candidateId: item.candidateId });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    if (result.email) toast.success(`Email trouvé : ${result.email}`);
    else toast.toast("Toujours rien. ORION retentera au prochain run.");
    onDone();
  }

  async function save() {
    setBusy("save");
    const result = await setTodayContact({
      prospectId,
      candidateId: item.candidateId,
      ...(email.trim() && email.trim() !== item.contact.email ? { email } : {}),
      ...(website.trim() && website.trim() !== item.website ? { website } : {}),
    });
    setBusy(null);
    if (!result.ok) return toast.error(result.error);
    toast.success("Fiche mise à jour.");
    onDone();
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-text">À compléter · {completionLabel(item.attempts)}</p>
        <Button size="sm" variant="secondary" loading={busy === "orion"} onClick={complete}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Compléter avec ORION
        </Button>
      </div>
      {!item.contact.email && item.contact.phone && (
        <p className="flex items-center gap-2 text-[13px] text-text">
          <Phone className="h-3.5 w-3.5 text-muted" aria-hidden />
          <a className="font-data underline-offset-2 hover:underline" href={`tel:${item.contact.phone.replace(/\s/g, "")}`}>
            {item.contact.phone}
          </a>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`email-${item.key}`}>Email</Label>
          <Input id={`email-${item.key}`} type="email" value={email} placeholder="prenom.nom@entreprise.fr" onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div>
          <Label htmlFor={`site-${item.key}`}>Site</Label>
          <Input id={`site-${item.key}`} value={website} placeholder="entreprise.fr" onChange={(event) => setWebsite(event.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" loading={busy === "save"} onClick={save} disabled={!email.trim() && !website.trim()}>
          Enregistrer
        </Button>
      </div>
    </section>
  );
}
