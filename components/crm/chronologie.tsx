"use client";

/**
 * Chronologie d'une fiche (Cowork #117) : ajout rapide (type, texte, date) avec, en option, la PROCHAINE ACTION datée
 * qui remonte dans « Aujourd'hui ». Liste du plus récent au plus ancien ; les changements d'étape y sont tracés.
 */
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { CalendarClock, FileText, Footprints, MessageSquare, Phone, StickyNote, Users, ArrowRightLeft, type LucideIcon } from "lucide-react";
import { Button, Input, Label, Select, Textarea, useToast } from "@/components/ui";
import { ajouterEvenement } from "@/app/(app)/crm/actions";
import { TYPES_EVENEMENT, libelleTypeEvenement, type Evenement } from "@/lib/crm/types";
import { dateHeure } from "./outils";

const ICONES: Record<string, LucideIcon> = { appel: Phone, visite: Footprints, message: MessageSquare, rdv: Users, devis: FileText, note: StickyNote, etape: ArrowRightLeft };

export function Chronologie({ commerceId, evenements, aujourdhui }: { commerceId: string; evenements: Evenement[]; aujourdhui: string }) {
  const router = useRouter();
  const toast = useToast();
  const formulaire = useRef<HTMLFormElement>(null);
  const [enCours, demarrer] = useTransition();

  const envoyer = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    demarrer(async () => {
      const r = await ajouterEvenement(commerceId, {
        type: d.type,
        contenu: d.contenu,
        survenuLe: d.survenuLe,
        ...(d.prochaineAction || d.prochaineActionLe ? { prochaineAction: d.prochaineAction, prochaineActionLe: d.prochaineActionLe } : {}),
      });
      if (!r.ok) return toast.error(r.error);
      toast.success("Ajouté à la chronologie");
      formulaire.current?.reset();
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="chronologie-titre" className="grid gap-3">
      <h2 id="chronologie-titre" className="font-display text-lg text-text">
        Chronologie
      </h2>
      <form ref={formulaire} onSubmit={envoyer} className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[10rem_minmax(0,1fr)_10rem]">
        <div>
          <Label htmlFor="evt-type">Quoi</Label>
          <Select id="evt-type" name="type" defaultValue="appel">
            {TYPES_EVENEMENT.filter((t) => t.id !== "etape").map((t) => (
              <option key={t.id} value={t.id}>
                {t.libelle}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="evt-contenu">Détail</Label>
          <Textarea id="evt-contenu" name="contenu" rows={1} placeholder="Ce qui s'est dit, la décision…" className="min-h-10" />
        </div>
        <div>
          <Label htmlFor="evt-date">Le</Label>
          <Input id="evt-date" name="survenuLe" type="date" defaultValue={aujourdhui} />
        </div>
        <details className="sm:col-span-3">
          <summary className="cursor-pointer py-1 text-sm text-primary-ink">Prévoir la prochaine action</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Input name="prochaineAction" placeholder="Rappeler, envoyer le devis…" aria-label="Prochaine action" />
            <Input name="prochaineActionLe" type="date" aria-label="Date de la prochaine action" />
          </div>
        </details>
        <div className="sm:col-span-3 sm:flex sm:justify-end">
          <Button type="submit" variant="secondary" loading={enCours} className="w-full sm:w-auto">
            Ajouter
          </Button>
        </div>
      </form>

      <ol className="grid gap-0" aria-label="Événements, du plus récent au plus ancien">
        {evenements.length === 0 && <li className="text-sm text-muted">Rien encore.</li>}
        {evenements.map((e) => {
          const Icone = ICONES[e.type] ?? StickyNote;
          return (
            <li key={e.id} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
              <span aria-hidden className="absolute bottom-0 left-4 top-8 w-px bg-line last:hidden" />
              <span className={`grid size-8 place-items-center rounded-full border ${e.type === "etape" ? "border-primary/25 bg-primary/10 text-primary-ink" : "border-line bg-surface-2 text-muted"}`}>
                <Icone className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 pt-1">
                <p className="text-sm text-text">
                  <span className="font-medium">{libelleTypeEvenement(e.type)}</span>
                  {e.contenu && <span className="text-muted"> — {e.contenu}</span>}
                </p>
                <p className="font-data text-xs text-faint">
                  <CalendarClock className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                  {dateHeure(e.survenu_le)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
