// Formulaires d'une facture émise : encaissement (alimente le livre des recettes) et avoir (seule correction possible).
import { Button, Input, Label, Select } from "@/components/ui";
import { emettreAvoir, creerEncaissement } from "@/app/compta/actions";
import { euros } from "@/lib/compta/calculs";
import { MOYENS } from "@/lib/compta/recettes";

export function FormEncaissement({ facture, jour }: { facture: { id: string; client_id: string; objet: string; reste: number }; jour: string }) {
  return (
    <form action={creerEncaissement} className="space-y-3">
      <input type="hidden" name="facture_id" value={facture.id} />
      <input type="hidden" name="client_id" value={facture.client_id} />
      <input type="hidden" name="nature" value={facture.objet} />
      <input type="hidden" name="retour" value={`/compta/factures/${facture.id}`} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" defaultValue={jour} required />
        </div>
        <div>
          <Label htmlFor="montant">Montant</Label>
          <Input id="montant" name="montant" inputMode="decimal" defaultValue={(facture.reste / 100).toFixed(2).replace(".", ",")} required />
        </div>
        <div>
          <Label htmlFor="moyen">Moyen</Label>
          <Select id="moyen" name="moyen" defaultValue="virement">
            {Object.entries(MOYENS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="reference">Référence</Label>
          <Input id="reference" name="reference" placeholder="n° de virement…" />
        </div>
      </div>
      <Button type="submit" variant="secondary">
        Enregistrer l&apos;encaissement
      </Button>
    </form>
  );
}

export function FormAvoir({ factureId, plafond }: { factureId: string; plafond: number }) {
  return (
    <form action={emettreAvoir} className="space-y-3">
      <input type="hidden" name="facture_id" value={factureId} />
      <div>
        <Label htmlFor="designation">Désignation</Label>
        <Input id="designation" name="designation" placeholder="Remise commerciale, prestation annulée…" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="avoir_montant">Montant (au plus {euros(plafond)})</Label>
          <Input id="avoir_montant" name="montant" inputMode="decimal" required />
        </div>
        <div>
          <Label htmlFor="motif">Motif</Label>
          <Input id="motif" name="motif" required />
        </div>
      </div>
      <Button type="submit" variant="outline">
        Émettre l&apos;avoir
      </Button>
    </form>
  );
}
