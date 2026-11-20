// Éléments partagés des écrans Compta : sous-navigation, jauge de seuil, statut de facture, saisie des lignes, alerte.
// Tokens du design system uniquement (CLAUDE.md) ; tout est utilisable sans JavaScript (formulaires simples).
import Link from "next/link";
import { Badge, Input, type BadgeTone } from "@/components/ui";
import { euros, type Jauge as JaugeValeurs } from "@/lib/compta/calculs";
import type { Ligne, StatutDevis, StatutPaiement } from "@/lib/compta/types";
import { cn } from "@/lib/utils";

const ONGLETS = [
  ["/compta", "Tableau de bord"],
  ["/compta/devis", "Devis"],
  ["/compta/factures", "Factures"],
  ["/compta/recettes", "Livre des recettes"],
  ["/compta/urssaf", "URSSAF"],
  ["/compta/seuils", "Seuils"],
  ["/compta/depenses", "Dépenses"],
  ["/compta/clients", "Clients"],
  ["/compta/parametres", "Paramètres"],
] as const;

export function SousNav({ actif }: { actif: string }) {
  return (
    <nav aria-label="Comptabilité" className="scrollbar-none -mx-4 mb-6 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      {ONGLETS.map(([href, libelle]) => (
        <Link
          key={href}
          href={href}
          aria-current={actif === href ? "page" : undefined}
          className={cn(
            "whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] transition-colors",
            actif === href ? "border-primary/25 bg-primary/10 font-medium text-primary-ink" : "border-line bg-surface text-muted hover:text-text",
          )}
        >
          {libelle}
        </Link>
      ))}
    </nav>
  );
}

export function Alerte({ erreur, ok }: { erreur?: string; ok?: string }) {
  if (!erreur && !ok) return null;
  return (
    <p role={erreur ? "alert" : "status"} className={cn("mb-5 rounded-lg border px-4 py-3 text-sm", erreur ? "border-lost/25 bg-lost/10 text-lost-ink" : "border-good/25 bg-good/10 text-good-ink")}>
      {erreur ?? ok}
    </p>
  );
}

const STATUTS: Record<StatutPaiement, [string, BadgeTone]> = {
  brouillon: ["Brouillon", "neutral"],
  emise: ["Émise", "info"],
  payee_partiellement: ["Payée partiellement", "warning"],
  payee: ["Payée", "success"],
  en_retard: ["En retard", "danger"],
  soldee_par_avoir: ["Soldée par avoir", "neutral"],
};
export const StatutFacture = ({ statut, avoir = false }: { statut: StatutPaiement; avoir?: boolean }) =>
  avoir && statut !== "brouillon" ? <Badge tone="accent">Avoir émis</Badge> : <Badge tone={STATUTS[statut][1]}>{STATUTS[statut][0]}</Badge>;

const DEVIS: Record<StatutDevis, [string, BadgeTone]> = { brouillon: ["Brouillon", "neutral"], envoye: ["Envoyé", "info"], accepte: ["Accepté", "success"], refuse: ["Refusé", "danger"] };
export const StatutDevisBadge = ({ statut }: { statut: StatutDevis }) => <Badge tone={DEVIS[statut][1]}>{DEVIS[statut][0]}</Badge>;

/** Jauge face à un seuil (alerte à 80 %). */
export function Jauge({ titre, valeurs, aide }: { titre: string; valeurs: JaugeValeurs; aide?: string }) {
  const pct = Math.min(100, Math.round(valeurs.ratio * 100));
  const ton = valeurs.depasse ? "bg-lost" : valeurs.alerte ? "bg-warn" : "bg-good";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-text">{titre}</p>
        <p className="font-data text-sm text-muted">
          {euros(valeurs.valeur)} / {euros(valeurs.seuil)}
        </p>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={titre}>
        <div className={cn("h-full rounded-full", ton)} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      <p className={cn("text-[12.5px]", valeurs.alerte ? "font-medium text-warn-ink" : "text-muted")}>
        {valeurs.depasse ? "Seuil dépassé" : valeurs.alerte ? `Alerte : ${pct} % du seuil atteint` : `${pct} % du seuil`}
        {aide ? ` · ${aide}` : ""}
      </p>
    </div>
  );
}

/** Saisie des lignes (désignation, quantité, prix unitaire) : 6 lignes, les vides sont ignorées. */
export function SaisieLignes({ initiales = [] }: { initiales?: Ligne[] }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 font-data text-[11px] uppercase tracking-wider text-muted">Lignes</legend>
      {Array.from({ length: 6 }, (_, i) => {
        const l = initiales[i];
        return (
          <div key={i} className="grid grid-cols-[1fr_4.5rem_6.5rem] gap-2">
            <Input name={`designation_${i}`} placeholder={i === 0 ? "Désignation" : ""} defaultValue={l?.designation} aria-label={`Désignation, ligne ${i + 1}`} />
            <Input name={`quantite_${i}`} inputMode="decimal" placeholder="Qté" defaultValue={l ? String(l.quantite) : ""} aria-label={`Quantité, ligne ${i + 1}`} />
            <Input name={`prix_${i}`} inputMode="decimal" placeholder="Prix HT €" defaultValue={l ? (l.prix_unitaire / 100).toFixed(2).replace(".", ",") : ""} aria-label={`Prix unitaire, ligne ${i + 1}`} />
          </div>
        );
      })}
    </fieldset>
  );
}

export const Montant = ({ c, className }: { c: number; className?: string }) => <span className={cn("font-data", className)}>{euros(c)}</span>;
