// Livre des recettes (F36018) : chronologique, date, client, nature, montant, mode de règlement, référence de la pièce
// justificative, espèces distinguées ; totaux par trimestre et pour la période. Export CSV (Excel FR) et PDF.
import { dateFr, euros, livreDesRecettes, trimestreDe } from "./calculs";
import { A4, couper, DocumentPdf, type Couleur } from "./pdf/ecrivain";
import type { Encaissement, MoyenPaiement } from "./types";

export const MOYENS: Record<MoyenPaiement, string> = {
  virement: "Virement",
  cheque: "Chèque",
  especes: "Espèces",
  carte: "Carte bancaire",
  plateforme: "Plateforme de paiement",
  autre: "Autre",
};

export type LigneRecette = Encaissement & { client_nom: string; piece: string | null };

/** Lignes du livre, dans l'ordre chronologique, avec le total trimestriel en fin de chaque trimestre. */
export function lignesLivre(encaissements: LigneRecette[]): { ligne: LigneRecette | null; sousTotal?: { libelle: string; montant: number } }[] {
  const tri = livreDesRecettes(encaissements);
  const sortie: { ligne: LigneRecette | null; sousTotal?: { libelle: string; montant: number } }[] = [];
  let cle = "";
  let cumul = 0;
  const fermer = () => cle && sortie.push({ ligne: null, sousTotal: { libelle: `Total ${cle}`, montant: cumul } });
  for (const e of tri) {
    const t = trimestreDe(e.date);
    const k = `T${t.trimestre} ${t.annee}`;
    if (k !== cle) (fermer(), (cle = k), (cumul = 0));
    cumul += e.montant;
    sortie.push({ ligne: e });
  }
  fermer();
  return sortie;
}

const champ = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const montantCsv = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/** CSV séparé par « ; », décimales à virgule, BOM UTF-8 : s'ouvre tel quel dans Excel en français. */
export function csvLivre(encaissements: LigneRecette[]): string {
  const entete = ["Date", "Client", "Nature", "Montant (EUR)", "Mode de règlement", "Pièce"];
  const lignes = livreDesRecettes(encaissements).map((e) => [dateFr(e.date), e.client_nom, e.nature, montantCsv(e.montant), MOYENS[e.moyen], [e.piece, e.reference].filter(Boolean).join(" / ")]);
  const total = encaissements.reduce((s, e) => s + e.montant, 0);
  return "﻿" + [entete, ...lignes, ["", "", "Total", montantCsv(total), "", ""]].map((l) => l.map(champ).join(";")).join("\r\n") + "\r\n";
}

const ENCRE: Couleur = [0.082, 0.071, 0.059];
const OR: Couleur = [0.784, 0.639, 0.373];
const CREME: Couleur = [0.953, 0.925, 0.878];

export function pdfLivre(encaissements: LigneRecette[], titulaire: string, periode: string): Uint8Array {
  const doc = new DocumentPdf(`Livre des recettes ${periode}`);
  const M = 40, D = A4.largeur - 40;
  const cols = [M + 6, M + 60, M + 178, M + 300, M + 382, D - 6]; // date, client, nature, mode, pièce, montant (aligné à droite)
  const entete = (y: number) => {
    doc.rectangle(M, y, D - M, 20, CREME);
    ["Date", "Client", "Nature", "Mode", "Pièce", "Montant"].forEach((t, i) => doc.texte(cols[i], y + 14, t, { taille: 8.5, gras: true, aligne: i === 5 ? "droite" : "gauche" }));
    return y + 34;
  };
  doc.rectangle(0, 0, A4.largeur, 64, ENCRE);
  doc.texte(M, 28, "LE WEB DES ARTISANS", { taille: 8.5, gras: true, couleur: OR });
  doc.texte(M, 48, `Livre des recettes — ${titulaire}`, { taille: 14, gras: true, couleur: CREME });
  doc.texte(D, 48, periode, { taille: 10, couleur: OR, aligne: "droite" });
  let y = entete(84);
  for (const { ligne, sousTotal } of lignesLivre(encaissements)) {
    if (y > A4.hauteur - 60) (doc.nouvellePage(), (y = entete(40)));
    if (sousTotal) {
      doc.filet(M, y - 10, D, OR);
      doc.texte(cols[4], y + 2, sousTotal.libelle, { taille: 8.5, gras: true, aligne: "droite" });
      doc.texte(cols[5], y + 2, euros(sousTotal.montant), { taille: 8.5, gras: true, aligne: "droite" });
      y += 22;
      continue;
    }
    const e = ligne!;
    const nature = couper(e.nature, 116, 8.5);
    doc.texte(cols[0], y, dateFr(e.date), { taille: 8.5 });
    doc.texte(cols[1], y, couper(e.client_nom, 112, 8.5)[0], { taille: 8.5 });
    nature.forEach((t, i) => doc.texte(cols[2], y + i * 11, t, { taille: 8.5 }));
    doc.texte(cols[3], y, MOYENS[e.moyen], { taille: 8.5, gras: e.moyen === "especes" });
    doc.texte(cols[4], y, e.piece ?? e.reference ?? "", { taille: 8.5 });
    doc.texte(cols[5], y, euros(e.montant), { taille: 8.5, aligne: "droite" });
    y += Math.max(1, nature.length) * 11 + 7;
  }
  const total = encaissements.reduce((s, e) => s + e.montant, 0);
  doc.rectangle(cols[4] - 90, y, D - cols[4] + 90 - 0, 20, ENCRE);
  doc.texte(cols[4], y + 14, "Total de la période", { taille: 9, gras: true, couleur: CREME, aligne: "droite" });
  doc.texte(cols[5], y + 14, euros(total), { taille: 9, gras: true, couleur: CREME, aligne: "droite" });
  return doc.octets();
}
