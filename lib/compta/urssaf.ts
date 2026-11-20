// Déclarations URSSAF trimestrielles : périodes, dates limites (reportées au jour ouvré suivant), ACRE, estimation
// indicative des cotisations. Pur et testé (scripts/compta.test.ts). Valeurs : lib/compta/config.ts.
import { COMPTA_CONFIG, ECHEANCES_TRIMESTRE } from "./config";
import { ajouterJours, bornesTrimestre, totalEntre, trimestreDe, trimestreSuivant, type Trimestre } from "./calculs";
import type { Centimes, Encaissement } from "./types";

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher), AAAA-MM-JJ. */
function paques(annee: number): string {
  const a = annee % 19, b = Math.floor(annee / 100), c = annee % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, "0")}-${String(jour).padStart(2, "0")}`;
}

/** Jours fériés légaux en métropole. */
export function joursFeries(annee: number): Set<string> {
  const p = paques(annee);
  const fixes = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map((j) => `${annee}-${j}`);
  return new Set([...fixes, ajouterJours(p, 1), ajouterJours(p, 39), ajouterJours(p, 50)]);
}

/** Jour ouvré égal ou suivant (ni samedi, ni dimanche, ni férié). */
export function jourOuvre(iso: string): string {
  let d = iso;
  for (;;) {
    const jour = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (jour !== 0 && jour !== 6 && !joursFeries(Number(d.slice(0, 4))).has(d)) return d;
    d = ajouterJours(d, 1);
  }
}

/** Date limite de déclaration du trimestre (report au jour ouvré suivant compris). */
export function dateLimite(t: Trimestre): string {
  const e = ECHEANCES_TRIMESTRE[t.trimestre];
  const annee = t.annee + (e.anneeSuivante ? 1 : 0);
  return jourOuvre(`${annee}-${String(e.mois).padStart(2, "0")}-${String(e.jour).padStart(2, "0")}`);
}

/** Fin de l'ACRE : dernier jour du 3e trimestre civil qui suit celui du début d'activité (01/09/2026 → 30/06/2027). */
export function finAcre(debut: string): string {
  let t = trimestreDe(debut);
  for (let k = 0; k < 3; k++) t = trimestreSuivant(t);
  return bornesTrimestre(t)[1];
}

export type Periode = { trimestre: Trimestre; debut: string; fin: string; limite: string; premiere: boolean };

/**
 * Périodes de déclaration depuis le début d'activité. La première couvre le trimestre du début ET le suivant (90 jours au
 * moins entre le début et la première déclaration ; tableau URSSAF : début entre le 1er juillet et le 30 septembre →
 * déclaration exigible le 31 janvier suivant). Ensuite, un trimestre civil par déclaration.
 */
export function periodes(debut: string, jusqua: string): Periode[] {
  const t0 = trimestreSuivant(trimestreDe(debut));
  const liste: Periode[] = [{ trimestre: t0, debut, fin: bornesTrimestre(t0)[1], limite: dateLimite(t0), premiere: true }];
  for (let t = trimestreSuivant(t0); bornesTrimestre(t)[0] <= jusqua; t = trimestreSuivant(t)) {
    const [d, f] = bornesTrimestre(t);
    liste.push({ trimestre: t, debut: d, fin: f, limite: dateLimite(t), premiere: false });
  }
  return liste;
}

export type Estimation = { chiffreAffaires: Centimes; taux: number; cotisations: Centimes; cfp: Centimes; total: Centimes; acre: boolean };

/** Estimation INDICATIVE des cotisations d'une période (CA encaissé × taux, ACRE si la période est couverte). */
export function estimer(encaissements: Encaissement[], p: Pick<Periode, "debut" | "fin">, acre: { active: boolean; fin: string | null }): Estimation {
  const chiffreAffaires = Math.max(0, totalEntre(encaissements, p.debut, p.fin));
  const sousAcre = acre.active && !!acre.fin && p.fin <= acre.fin;
  const taux = COMPTA_CONFIG.tauxCotisations * (sousAcre ? COMPTA_CONFIG.facteurAcre : 1);
  const cotisations = Math.round(chiffreAffaires * taux);
  const cfp = Math.round(chiffreAffaires * COMPTA_CONFIG.tauxCfp);
  return { chiffreAffaires, taux, cotisations, cfp, total: cotisations + cfp, acre: sousAcre };
}

/** Plafond proratisé l'année de création (jours d'activité / jours de l'année). */
export function plafondProratise(plafond: Centimes, debut: string | null, annee: number): Centimes {
  if (!debut || Number(debut.slice(0, 4)) !== annee) return plafond;
  const fin = Date.UTC(annee, 11, 31);
  const jours = Math.round((fin - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000) + 1;
  const total = annee % 4 === 0 && (annee % 100 !== 0 || annee % 400 === 0) ? 366 : 365;
  return Math.round((plafond * jours) / total);
}
