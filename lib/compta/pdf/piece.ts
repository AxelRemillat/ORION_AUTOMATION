// PDF d'un devis, d'une facture ou d'un avoir, aux couleurs du Web des Artisans. Mentions obligatoires d'une facture de
// micro-entrepreneur en franchise de TVA (F31808, F36008, F23211 — voir lib/compta/config.ts et docs/COMPTA.md).
import { MENTIONS_PAIEMENT } from "../config";
import { ajouterJours, dateFr, echeanceFacture, euros } from "../calculs";
import type { ClientFige, Devis, Emetteur, Facture } from "../types";
import { A4, couper, DocumentPdf, type Couleur } from "./ecrivain";

// Couleurs de la marque Le Web des Artisans (PDF seulement : l'interface d'ORION n'emploie que ses tokens).
const ENCRE: Couleur = [0.082, 0.071, 0.059];
const OR: Couleur = [0.784, 0.639, 0.373];
const CREME: Couleur = [0.953, 0.925, 0.878];
const DOUX: Couleur = [0.4, 0.36, 0.32];
const M = 48; // marge
const D = A4.largeur - M;

/** « Nom EI » : la mention « EI » suit le nom de l'entrepreneur individuel (F31808). */
export const nomEi = (nom: string) => (/\b(EI|entrepreneur individuel)\b/i.test(nom) ? nom : `${nom} EI`);

type Piece =
  | { genre: "devis"; devis: Devis; emetteur: Emetteur; client: ClientFige }
  | { genre: "facture"; facture: Facture & { emetteur: Emetteur; client: ClientFige }; origine?: string | null };

export function pdfPiece(p: Piece): Uint8Array {
  const avoir = p.genre === "facture" && p.facture.type === "avoir";
  const titre = p.genre === "devis" ? "DEVIS" : avoir ? "AVOIR" : "FACTURE";
  const numero = p.genre === "devis" ? p.devis.numero : (p.facture.numero ?? "BROUILLON");
  const emetteur = p.genre === "devis" ? p.emetteur : p.facture.emetteur;
  const client = p.genre === "devis" ? p.client : p.facture.client;
  const lignes = p.genre === "devis" ? p.devis.lignes : p.facture.lignes;
  const total = p.genre === "devis" ? p.devis.total : p.facture.total;
  const doc = new DocumentPdf(`${titre} ${numero}`);

  // Bandeau.
  doc.rectangle(0, 0, A4.largeur, 78, ENCRE);
  doc.texte(M, 34, "LE WEB DES ARTISANS", { taille: 9, gras: true, couleur: OR });
  doc.texte(M, 56, nomEi(emetteur.nom), { taille: 15, gras: true, couleur: CREME });
  doc.texte(D, 40, titre, { taille: 22, gras: true, couleur: CREME, aligne: "droite" });
  doc.texte(D, 60, `N° ${numero}`, { taille: 11, couleur: OR, aligne: "droite" });

  // Émetteur et client.
  let y = 112;
  const bloc = (x: number, intitule: string, lignesTexte: string[]) => {
    doc.texte(x, y, intitule, { taille: 8, gras: true, couleur: DOUX });
    lignesTexte.filter(Boolean).forEach((l, i) => doc.texte(x, y + 16 + i * 13, l, { taille: 10, gras: i === 0 }));
  };
  bloc(M, "ÉMETTEUR", [nomEi(emetteur.nom), ...emetteur.adresse.split("\n"), `SIRET ${emetteur.siret}`, emetteur.email ?? "", emetteur.telephone ?? ""]);
  bloc(320, client.professionnel ? "CLIENT (PROFESSIONNEL)" : "CLIENT", [client.nom, ...client.adresse.split("\n"), client.siren ? `SIREN ${client.siren}` : ""]);

  // Dates.
  y = 218;
  doc.filet(M, y - 14, D, OR, 1);
  const dates: [string, string][] =
    p.genre === "devis"
      ? [["Date du devis", dateFr(p.devis.date)], ["Valable jusqu'au", dateFr(ajouterJours(p.devis.date, p.devis.validite_jours))]]
      : [
          ["Date d'émission", p.facture.date_emission ? dateFr(p.facture.date_emission) : "—"],
          ["Date de la prestation", p.facture.date_prestation || "—"],
          ...(avoir ? [] : ([["Échéance de paiement", echeanceFacture(p.facture) ? dateFr(echeanceFacture(p.facture)!) : "—"]] as [string, string][])),
        ];
  dates.forEach(([l, v], i) => {
    doc.texte(M + i * 170, y, l, { taille: 8, gras: true, couleur: DOUX });
    doc.texte(M + i * 170, y + 14, v, { taille: 10 });
  });
  y += 40;
  const objet = p.genre === "devis" ? p.devis.objet : p.facture.objet;
  if (objet) doc.texte(M, y, `Objet : ${objet}`, { taille: 10, gras: true }), (y += 16);
  if (avoir) doc.texte(M, y, `Avoir sur la facture n° ${p.origine ?? "—"}${p.facture.motif_avoir ? ` — ${p.facture.motif_avoir}` : ""}`, { taille: 10 }), (y += 16);

  // Lignes.
  y += 8;
  doc.rectangle(M, y, D - M, 22, CREME);
  const cols = { qte: 360, pu: 440, tot: D - 8 };
  doc.texte(M + 8, y + 15, "Désignation", { taille: 9, gras: true });
  doc.texte(cols.qte, y + 15, "Qté", { taille: 9, gras: true, aligne: "droite" });
  doc.texte(cols.pu, y + 15, "Prix unitaire HT", { taille: 9, gras: true, aligne: "droite" });
  doc.texte(cols.tot, y + 15, "Total HT", { taille: 9, gras: true, aligne: "droite" });
  y += 38;
  for (const l of lignes) {
    const textes = couper(l.designation, 270, 10);
    if (y + textes.length * 13 > A4.hauteur - 200) (doc.nouvellePage(), (y = 60));
    textes.forEach((t, i) => doc.texte(M + 8, y + i * 13, t, { taille: 10 }));
    doc.texte(cols.qte, y, String(l.quantite).replace(".", ","), { taille: 10, aligne: "droite" });
    doc.texte(cols.pu, y, euros(l.prix_unitaire), { taille: 10, aligne: "droite" });
    doc.texte(cols.tot, y, euros(Math.round(l.quantite * l.prix_unitaire)), { taille: 10, aligne: "droite" });
    y += textes.length * 13 + 8;
    doc.filet(M, y - 4, D, CREME);
  }

  // Totaux.
  y += 10;
  const totaux: [string, string, boolean][] = [
    ["Total HT", euros(total), false],
    ["TVA", "non applicable", false],
    [p.genre === "devis" ? "Total à payer" : avoir ? "Montant de l'avoir" : "Net à payer", euros(total), true],
  ];
  totaux.forEach(([l, v, fort], i) => {
    if (fort) doc.rectangle(330, y + i * 18 - 13, D - 330, 20, ENCRE);
    doc.texte(340, y + i * 18, l, { taille: 10, gras: fort, couleur: fort ? CREME : ENCRE });
    doc.texte(D - 8, y + i * 18, v, { taille: 10, gras: fort, couleur: fort ? CREME : ENCRE, aligne: "droite" });
  });
  y += 70;

  // Mentions.
  const mentions: string[] = [MENTIONS_PAIEMENT.franchiseTva];
  if (p.genre === "devis") {
    if (p.devis.conditions) mentions.push(`Conditions : ${p.devis.conditions}`);
    mentions.push(`Devis valable ${p.devis.validite_jours} jours. Bon pour accord (date et signature) :`);
  } else if (!avoir) {
    mentions.push(`Paiement à ${p.facture.echeance_jours} jours${emetteur.iban ? `, par virement sur l'IBAN ${emetteur.iban}` : ""}.`, MENTIONS_PAIEMENT.escompte, MENTIONS_PAIEMENT.penalites + ".");
    if (client.professionnel) mentions.push(MENTIONS_PAIEMENT.indemnitePro + ".");
  }
  if (y > A4.hauteur - 150) (doc.nouvellePage(), (y = 60));
  doc.filet(M, y - 14, D, OR, 1);
  for (const [i, m] of mentions.entries()) {
    for (const t of couper(m, D - M, i === 0 ? 10 : 8.5, i === 0)) {
      doc.texte(M, y, t, { taille: i === 0 ? 10 : 8.5, gras: i === 0, couleur: i === 0 ? ENCRE : DOUX });
      y += i === 0 ? 15 : 12;
    }
  }
  doc.texte(A4.largeur / 2, A4.hauteur - 28, `${nomEi(emetteur.nom)} · SIRET ${emetteur.siret} · ${titre} ${numero}`, { taille: 7.5, couleur: DOUX, aligne: "centre" });
  return doc.octets();
}
