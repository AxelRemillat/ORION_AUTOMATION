"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Radar, Save } from "lucide-react";
import { Button, Input, Label, useToast } from "@/components/ui";
import type { FunnelPrefs } from "@/lib/funnel/settings";

/**
 * Réglages de l'entonnoir : zones, fenêtre, plafond de fiches creusées,
 * secteurs, et run quotidien à 6 h. Les listes se saisissent séparées par des
 * virgules : ce sont des préfixes (« 69 », « 4711 »), pas des libellés.
 */

const split = (value: string) => value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);

/**
 * `onStart` absent (Réglages › Paramètres) : le formulaire enregistre seulement,
 * sans bouton « Lancer l'entonnoir ».
 */
export function FunnelSettings({ onStart, busy = false }: { onStart?: () => void; busy?: boolean }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState<FunnelPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  /** Saisie brute des trois listes, convertie à l'enregistrement. */
  const [text, setText] = useState({ zones: "", preferred: "", excluded: "" });

  useEffect(() => {
    void fetch("/api/funnel/settings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { prefs: FunnelPrefs } | null) => {
        if (!body) return;
        setPrefs(body.prefs);
        setText({
          zones: body.prefs.departements.join(", "),
          preferred: body.prefs.preferredSectors.join(", "),
          excluded: body.prefs.excludedSectors.join(", "),
        });
      })
      .catch(() => undefined);
  }, []);

  if (!prefs) return <p className="text-[13px] text-muted">Chargement des réglages…</p>;
  const set = (patch: Partial<FunnelPrefs>) => setPrefs({ ...prefs, ...patch });

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const response = await fetch("/api/funnel/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...prefs,
          departements: split(text.zones),
          preferredSectors: split(text.preferred),
          excludedSectors: split(text.excluded),
        }),
      });
      const body = (await response.json()) as { prefs?: FunnelPrefs; error?: string };
      if (!response.ok || !body.prefs) throw new Error(body.error ?? "Enregistrement refusé.");
      setPrefs(body.prefs);
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Enregistrement refusé.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Aucun département : toute la France (moisson nationale).
    if (!(await save())) return;
    if (onStart) onStart();
    else toast.success("Réglages enregistrés.");
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-4">
      <div className="md:col-span-2">
        <Label htmlFor="funnel-zones">Départements</Label>
        <Input
          id="funnel-zones"
          placeholder="69, 31 — vide : toute la France"
          value={text.zones}
          onChange={(event) => setText({ ...text, zones: event.target.value })}
          aria-describedby="funnel-zones-hint"
        />
        <p id="funnel-zones-hint" className="mt-1 text-[12px] text-faint">
          {split(text.zones).length ? `${split(text.zones).length} département(s)` : "Toute la France : moisson nationale, plus longue"}
        </p>
      </div>
      <div>
        <Label htmlFor="funnel-days">Fenêtre (jours)</Label>
        <Input id="funnel-days" type="number" min={1} max={90} value={prefs.days} onChange={(event) => set({ days: Number(event.target.value) || 14 })} />
      </div>
      <div>
        <Label htmlFor="funnel-limit">Fiches à creuser</Label>
        <Input id="funnel-limit" type="number" min={1} max={30} value={prefs.digLimit} onChange={(event) => set({ digLimit: Number(event.target.value) || 15 })} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="funnel-preferred">Secteurs préférés (préfixes NAF)</Label>
        <Input id="funnel-preferred" value={text.preferred} onChange={(event) => setText({ ...text, preferred: event.target.value })} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="funnel-excluded">Secteurs exclus (préfixes NAF)</Label>
        <Input id="funnel-excluded" value={text.excluded} onChange={(event) => setText({ ...text, excluded: event.target.value })} />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-4">
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" checked={prefs.daily} onChange={(event) => set({ daily: event.target.checked })} />
          Préparer « Aujourd’hui » du lundi au vendredi à {prefs.autoHour} h (heure de Paris) avec ces réglages
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="secondary" loading={saving} onClick={() => void save().then((ok) => ok && toast.success("Réglages enregistrés."))}>
            <Save className="h-4 w-4" /> Enregistrer
          </Button>
          {onStart && (
            <Button type="submit" loading={busy}>
              <Radar className="h-4 w-4" /> Lancer l’entonnoir
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
