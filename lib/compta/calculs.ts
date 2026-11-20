// Calculs purs de la comptabilité (sans base, sans date courante implicite) : totaux, numéros, statut de paiement,
// trimestres, livre des recettes, jauges. Testés par scripts/compta.test.ts.
import type { Centimes, Encaissement, Facture, Ligne, StatutPaiement } from "./types";

/** Total d'une liste de lignes, en centimes (quantité décimale possible : arrondi au centime par ligne). */
export function totalLignes(lignes: Ligne[]): Centimes {
  return lignes.reduce((s, l) => s + Math.round(l.quantite * l.prix_unitaire), 0);
}

/** « D-2026-007 », « F-2026-012 », « A-2026-001 ». */
export function formatNumero(prefixe: "D" | "F" | "A", annee: number, rang: number): string {
  return `${prefixe}-${annee}-${String(rang).padStart(3, "0")}`;
}

export function lireNumero(numero: string): { prefixe: string; annee: number; rang: number } | null {
  const m = /^([DFA])-(\d{4})-(\d{3,})$/.exec(numero);
  return m ? { prefixe: m[1], annee: Number(m[2]), rang: Number(m[3]) } : null;
}

/** Vrai si les numéros d'une série (même préfixe, même année) se suivent sans trou ni doublon depuis 1. */
export function serieSansTrou(numeros: string[]): boolean {
  const parSerie = new Map<string, number[]>();
  for (const n of numeros) {
    const l = lireNumero(n);
    if (!l) return false;
    const k = `${l.prefixe}-${l.annee}`;
    parSerie.set(k, [...(parSerie.get(k) ?? []), l.rang]);
  }
  return [...parSerie.values()].every((rangs) => rangs.sort((a, b) => a - b).every((r, i) => r === i + 1));
}

export const ajouterJours = (iso: string, jours: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
};

export const echeanceFacture = (f: Pick<Facture, "date_emission" | "echeance_jours">): string | null =>
  f.date_emission ? ajouterJours(f.date_emission, f.echeance_jours) : null;

/** Reste dû d'une facture : total − avoirs émis qui la corrigent − encaissements reçus. */
export function resteDu(f: Facture, avoirs: Facture[], encaissements: Encaissement[]): Centimes {
  const corrige = avoirs.filter((a) => a.type === "avoir" && a.etat === "emise" && a.facture_origine_id === f.id).reduce((s, a) => s + a.total, 0);
  const paye = encaissements.filter((e) => e.facture_id === f.id).reduce((s, e) => s + e.montant, 0);
  return f.total - corrige - paye;
}

/** Statut affiché d'une facture (jamais stocké) : émise, payée partiellement, payée, en retard, soldée par avoir. */
export function statutPaiement(f: Facture, avoirs: Facture[], encaissements: Encaissement[], aujourdhui: string): StatutPaiement {
  if (f.etat === "brouillon") return "brouillon";
  if (f.type === "avoir") return "emise";
  const reste = resteDu(f, avoirs, encaissements);
  const paye = encaissements.filter((e) => e.facture_id === f.id).reduce((s, e) => s + e.montant, 0);
  if (reste <= 0) return paye > 0 ? "payee" : "soldee_par_avoir";
  const echeance = echeanceFacture(f);
  if (echeance && aujourdhui > echeance) return "en_retard";
  return paye > 0 ? "payee_partiellement" : "emise";
}

export type Trimestre = { annee: number; trimestre: 1 | 2 | 3 | 4 };
export const trimestreDe = (iso: string): Trimestre => ({ annee: Number(iso.slice(0, 4)), trimestre: (Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4 });
export const bornesTrimestre = ({ annee, trimestre }: Trimestre): [string, string] => {
  const debut = `${annee}-${String((trimestre - 1) * 3 + 1).padStart(2, "0")}-01`;
  const fin = new Date(Date.UTC(annee, trimestre * 3, 0)).toISOString().slice(0, 10);
  return [debut, fin];
};
export const trimestreSuivant = ({ annee, trimestre }: Trimestre): Trimestre => (trimestre === 4 ? { annee: annee + 1, trimestre: 1 } : { annee, trimestre: (trimestre + 1) as 1 | 2 | 3 | 4 });

/** Encaissements compris entre deux dates incluses (remboursements négatifs compris). */
export const totalEntre = (encaissements: Encaissement[], debut: string, fin: string): Centimes =>
  encaissements.filter((e) => e.date >= debut && e.date <= fin).reduce((s, e) => s + e.montant, 0);

/** Chiffre d'affaires à déclarer pour un trimestre : la somme des ENCAISSEMENTS (BNC), pas des factures émises. */
export const totalTrimestre = (encaissements: Encaissement[], t: Trimestre): Centimes => totalEntre(encaissements, ...bornesTrimestre(t));

/** Livre des recettes : encaissements dans l'ordre chronologique (date, puis ordre de saisie). */
export function livreDesRecettes<T extends Encaissement>(encaissements: T[]): T[] {
  return encaissements.map((e, i) => ({ e, i })).sort((a, b) => (a.e.date === b.e.date ? a.i - b.i : a.e.date < b.e.date ? -1 : 1)).map((x) => x.e);
}

export type Jauge = { valeur: Centimes; seuil: Centimes; ratio: number; alerte: boolean; depasse: boolean };
/** Jauge face à un seuil : alerte dès `alerte` (0,8 = 80 %). */
export function jauge(valeur: Centimes, seuil: Centimes, alerte = 0.8): Jauge {
  const ratio = seuil > 0 ? valeur / seuil : 0;
  return { valeur, seuil, ratio, alerte: ratio >= alerte, depasse: ratio >= 1 };
}

/** « 1 234,50 € » (espaces insécables, comme l'affichage français). */
export function euros(c: Centimes): string {
  const signe = c < 0 ? "-" : "";
  const v = Math.abs(c);
  const entier = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${signe}${entier},${String(v % 100).padStart(2, "0")} €`;
}

/** « 1234,5 » ou « 1234.50 » saisi → centimes ; null si illisible. */
export function lireEuros(texte: string): Centimes | null {
  const t = texte.replace(/[\s  €]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export const dateFr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
