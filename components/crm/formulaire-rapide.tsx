"use client";

/**
 * Création d'une fiche en moins de 30 s, en rendez-vous sur le téléphone (Cowork #117) : le nom suffit, le reste
 * est facultatif. Clavier adapté (téléphone, texte), ordre de saisie naturel, une seule action.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, Input, Label, Modal, Select, useToast } from "@/components/ui";
import { creerCommerce } from "@/app/(app)/crm/actions";
import { CANAUX, ETAPES } from "@/lib/crm/types";

export function FormulaireRapide({ ouvert, onFermer }: { ouvert: boolean; onFermer: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const formulaire = useRef<HTMLFormElement>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [enCours, demarrer] = useTransition();

  const envoyer = (ouvrirFiche: boolean) => {
    const f = formulaire.current;
    if (!f) return;
    const d = Object.fromEntries(new FormData(f).entries());
    demarrer(async () => {
      const r = await creerCommerce(d);
      if (!r.ok) {
        setErreurs(r.erreurs ?? {});
        toast.error(r.error);
        return;
      }
      setErreurs({});
      toast.success(`« ${String(d.nom).trim()} » ajouté au CRM`);
      f.reset();
      onFermer();
      if (ouvrirFiche) router.push(`/crm/${r.id}`);
      else router.refresh();
    });
  };

  return (
    <Modal
      open={ouvert}
      onClose={onFermer}
      title="Nouvelle fiche"
      description="Le nom suffit ; le reste se complète plus tard."
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => envoyer(true)} disabled={enCours}>
            Créer et ouvrir
          </Button>
          <Button onClick={() => envoyer(false)} loading={enCours}>
            Créer
          </Button>
        </div>
      }
    >
      <form
        ref={formulaire}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          envoyer(false);
        }}
      >
        <div className="sm:col-span-2">
          <Label htmlFor="rapide-nom">Nom du commerce *</Label>
          <Input id="rapide-nom" name="nom" required autoFocus autoComplete="off" enterKeyHint="next" error={erreurs.nom} />
        </div>
        <div>
          <Label htmlFor="rapide-metier">Métier</Label>
          <Input id="rapide-metier" name="metier" placeholder="Boulangerie, coiffure…" autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="rapide-ville">Ville</Label>
          <Input id="rapide-ville" name="ville" autoComplete="address-level2" />
        </div>
        <div>
          <Label htmlFor="rapide-tel">Téléphone</Label>
          <Input id="rapide-tel" name="telephone" type="tel" inputMode="tel" autoComplete="tel" />
        </div>
        <div>
          <Label htmlFor="rapide-canal">Canal d&apos;origine</Label>
          <Select id="rapide-canal" name="canal" defaultValue="terrain">
            {CANAUX.filter((c) => c.id !== "prospection_email").map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="rapide-etape">Étape</Label>
          <Select id="rapide-etape" name="etape" defaultValue="a_contacter">
            {ETAPES.filter((e) => e.id !== "perdu").map((e) => (
              <option key={e.id} value={e.id}>
                {e.libelle}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="rapide-action-le">Prochaine action le</Label>
          <Input id="rapide-action-le" name="prochaine_action_le" type="date" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="rapide-action">Prochaine action</Label>
          <Input id="rapide-action" name="prochaine_action" placeholder="Rappeler, passer en boutique…" autoComplete="off" enterKeyHint="done" />
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
