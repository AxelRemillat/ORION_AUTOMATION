"use client";

import { Button, Input, Label } from "@/components/ui";

/**
 * Destinataire d'un envoi. Seules les adresses TROUVÉES sont proposées, avec
 * leur source : l'ancien préremplissage « contact@<domaine> » était une
 * devinette, désormais refusée par le contrôle avant envoi.
 */
export function RecipientField({
  id,
  value,
  onChange,
  suggestions = [],
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions?: { email: string; source: string }[];
}) {
  return (
    <div>
      <Label htmlFor={id}>Destinataire</Label>
      <Input id={id} type="email" value={value} onChange={(event) => onChange(event.target.value)} placeholder="prenom.nom@entreprise.fr" />
      {suggestions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((item) => (
            <Button key={item.email} size="sm" variant="secondary" onClick={() => onChange(item.email)}>
              {item.email} · <span className="text-faint">{item.source}</span>
            </Button>
          ))}
        </div>
      ) : (
        !value && <p className="mt-1 text-[12px] text-faint">Aucune adresse trouvée pour ce prospect : saisissez-la.</p>
      )}
    </div>
  );
}
