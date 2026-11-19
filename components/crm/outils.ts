/** Petits outils d'affichage du CRM (Cowork #117) : étapes en couleur, dates en français. */
import type { BadgeTone } from "@/components/ui";
import type { Etape } from "@/lib/crm/types";

/** Ton du badge par étape : bleu tant que ça avance, vert signé / en ligne, rouge perdu. */
export const TON_ETAPE: Record<Etape, BadgeTone> = {
  a_contacter: "neutral",
  contacte: "info",
  maquette_envoyee: "info",
  rdv: "accent",
  devis_envoye: "warning",
  signe: "success",
  en_ligne: "success",
  perdu: "danger",
};

const FORMAT_JOUR = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** « mar. 18 nov. » pour une date civile AAAA-MM-JJ (lue à midi pour éviter tout décalage de fuseau). */
export const jourCourt = (d: string | null) => (d ? FORMAT_JOUR.format(new Date(`${d}T12:00:00Z`)) : "");
export const dateHeure = (iso: string) => FORMAT_DATE_HEURE.format(new Date(iso));

/** Échéance lisible et son urgence : en retard, aujourd'hui, demain, à venir. */
export function echeance(d: string | null, aujourdhui: string): { texte: string; urgence: "retard" | "jour" | "proche" | "plus-tard" } | null {
  if (!d) return null;
  const jours = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${aujourdhui}T00:00:00Z`)) / 86_400_000);
  if (jours < 0) return { texte: jours === -1 ? "hier" : `il y a ${-jours} j`, urgence: "retard" };
  if (jours === 0) return { texte: "aujourd'hui", urgence: "jour" };
  if (jours === 1) return { texte: "demain", urgence: "proche" };
  return { texte: jourCourt(d), urgence: jours <= 7 ? "proche" : "plus-tard" };
}

export const CLASSE_URGENCE = {
  retard: "text-lost-ink",
  jour: "text-warn-ink",
  proche: "text-primary-ink",
  "plus-tard": "text-muted",
} as const;

/** Montant en euros, chiffres tabulaires (à poser avec `font-data`). */
export const euros = (n: number | null) =>
  n === null ? "" : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
