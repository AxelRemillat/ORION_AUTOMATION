"use client";

/**
 * Changement d'étape partagé par le tableau, le kanban et la fiche (Cowork #117). « Perdu » demande un motif dans
 * une petite fenêtre ; les autres étapes partent tout de suite. Chaque changement laisse un événement dans la
 * chronologie (côté serveur).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, Input, Label, Modal, useToast } from "@/components/ui";
import { deplacerCommerce } from "@/app/(app)/crm/actions";
import { libelleEtape } from "@/lib/crm/types";

export function useDeplacer(): { deplacer: (id: string, nom: string, etape: string) => void; enCours: boolean; fenetre: ReactNode } {
  const router = useRouter();
  const toast = useToast();
  const [enCours, demarrer] = useTransition();
  const [perte, setPerte] = useState<{ id: string; nom: string } | null>(null);
  const [motif, setMotif] = useState("");

  const envoyer = (id: string, nom: string, etape: string, m?: string) =>
    demarrer(async () => {
      const r = await deplacerCommerce(id, etape, m);
      if (!r.ok) return toast.error(r.error);
      toast.success(`${nom} → ${libelleEtape(etape)}`);
      router.refresh();
    });

  const deplacer = (id: string, nom: string, etape: string) => {
    if (etape === "perdu") {
      setMotif("");
      setPerte({ id, nom });
    } else envoyer(id, nom, etape);
  };

  const fenetre = (
    <Modal
      open={perte !== null}
      onClose={() => setPerte(null)}
      title={perte ? `${perte.nom} : perdu` : ""}
      description="Le motif reste dans la chronologie, pour comprendre plus tard."
      size="sm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={() => setPerte(null)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={!motif.trim()}
            onClick={() => {
              if (perte) envoyer(perte.id, perte.nom, "perdu", motif);
              setPerte(null);
            }}
          >
            Marquer perdu
          </Button>
        </div>
      }
    >
      <Label htmlFor="motif-perte">Motif</Label>
      <Input id="motif-perte" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="A déjà un prestataire, trop cher…" autoFocus />
    </Modal>
  );

  return { deplacer, enCours, fenetre };
}
