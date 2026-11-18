/**
 * COMPTABILITÉ de la micro-entreprise (Cowork #70), sans base ni réseau : numérotation sans trou, facture émise
 * immuable, avoir, statuts de paiement, livre des recettes, total du trimestre, échéances URSSAF et ACRE, seuils,
 * PDF (mentions obligatoires présentes). Les garanties SQL (concurrence réelle, RLS) : scripts/compta-sql.
 * `npm run test:compta`
 */
import { bornesTrimestre, euros, jauge, lireEuros, livreDesRecettes, serieSansTrou, statutPaiement, totalTrimestre } from "../lib/compta/calculs";
import { COMPTA_CONFIG, MENTIONS_PAIEMENT } from "../lib/compta/config";
import { depotMemoire } from "../lib/compta/depot-memoire";
import { AUJOURDHUI_DEMO, etatDemo, etatVide } from "../lib/compta/fixtures";
import { pdfPiece } from "../lib/compta/pdf/piece";
import { csvLivre, lignesLivre, pdfLivre, type LigneRecette } from "../lib/compta/recettes";
import { dateLimite, estimer, finAcre, jourOuvre, periodes, plafondProratise } from "../lib/compta/urssaf";
import type { Emetteur, ClientFige, Facture } from "../lib/compta/types";
import { compteAutorise } from "../lib/compta/regle-acces";
import { isComptaDemoPath } from "../middleware";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}
async function rejet(f: () => Promise<unknown>, motif: RegExp): Promise<boolean> {
  try {
    await f();
    return false;
  } catch (e) {
    return motif.test(String((e as Error).message));
  }
}
const texte = (octets: Uint8Array) => Buffer.from(octets).toString("latin1");
/** Texte tel qu'il est écrit dans un flux PDF : WinAnsi (€ = 0x80), parenthèses et antislash échappés. */
const winAnsi = (s: string) => Buffer.from(s.replace(/€/g, "\u0080").replace(/[()\\]/g, (c) => `\\${c}`), "latin1").toString("latin1");

async function main() {
  console.log("Numérotation et immuabilité");
  const etat = etatVide();
  let jour = "2026-11-02";
  const d = depotMemoire(etat, () => jour);
  const lignes = [{ designation: "Site", quantite: 1, prix_unitaire: 50_000 }];
  const c = await d.creerClient({ nom: "Client Test", professionnel: true, siren: null, adresse: "1 rue Test", email: null, crm_ref: null });
  const f0 = await d.creerFacture({ client_id: c, objet: "Test", lignes, date_prestation: "novembre 2026", echeance_jours: 30 });
  check("émission refusée sans paramètres de l'émetteur", await rejet(() => d.emettre(f0), /paramètres/));
  await d.enregistrerParametres({ nom: "Émetteur Test", adresse: "1 rue de l'Exemple", siret: "000 000 000 00000", email: null, telephone: null, iban: null, date_debut_activite: "2026-09-01", acre: true });
  check("brouillon sans numéro", (await d.factures()).every((f) => f.numero === null));
  const ids = [f0];
  for (let i = 0; i < 9; i++) ids.push(await d.creerFacture({ client_id: c, objet: `T${i}`, lignes, date_prestation: "", echeance_jours: 30 }));
  const zero = await d.creerFacture({ client_id: c, objet: "zéro", lignes: [], date_prestation: "", echeance_jours: 30 });
  check("facture à 0 € refusée", await rejet(() => d.emettre(zero), /0 €/));
  const emises = await Promise.all(ids.map((id) => d.emettre(id)));
  const numeros = emises.map((f) => f.numero!);
  check(`10 émissions : ${numeros[0]} … ${numeros.at(-1)}, sans trou`, serieSansTrou(numeros) && numeros[0] === "F-2026-001" && numeros.at(-1) === "F-2026-010", numeros);
  check("série avec un trou détectée", !serieSansTrou(["F-2026-001", "F-2026-003"]));
  check("série avec un doublon détectée", !serieSansTrou(["F-2026-001", "F-2026-001"]));
  check("facture émise : modification refusée", await rejet(() => d.modifierBrouillon(f0, { objet: "x" }), /plus modifiable/));
  check("facture émise : suppression refusée", await rejet(() => d.supprimerBrouillon(f0), /plus modifiable/));
  check("coordonnées figées à l'émission", emises[0].emetteur?.nom === "Émetteur Test" && emises[0].client?.nom === "Client Test");
  jour = "2027-01-04";
  const f2027 = await d.creerFacture({ client_id: c, objet: "2027", lignes, date_prestation: "", echeance_jours: 30 });
  check("nouvelle année : F-2027-001", (await d.emettre(f2027)).numero === "F-2027-001");

  console.log("Avoir");
  const av = await d.creerAvoir(f0, [{ designation: "Remise", quantite: 1, prix_unitaire: 20_000 }], "Remise");
  const avoir = await d.emettre(av);
  check(`avoir dans sa série (${avoir.numero})`, avoir.numero === "A-2027-001" && avoir.type === "avoir");
  const trop = await d.creerAvoir(f0, [{ designation: "Trop", quantite: 1, prix_unitaire: 30_001 }], "x");
  check("avoir au-delà du restant refusé", await rejet(() => d.emettre(trop), /dépasse/));

  console.log("Statuts de paiement");
  const base = (await d.factures()).find((f) => f.id === ids[1])!;
  const enc = (montant: number, facture = base.id) => ({ id: "e", date: "2026-11-10", montant, moyen: "virement" as const, facture_id: facture, client_id: c, nature: "x", reference: null });
  check("émise", statutPaiement(base, [], [], "2026-11-20") === "emise");
  check("payée partiellement", statutPaiement(base, [], [enc(10_000)], "2026-11-20") === "payee_partiellement");
  check("payée", statutPaiement(base, [], [enc(50_000)], "2026-11-20") === "payee");
  check("en retard après l'échéance (30 j)", statutPaiement(base, [], [enc(10_000)], "2026-12-03") === "en_retard");
  const f0b = (await d.factures()).find((f) => f.id === f0)!;
  check("avoir déduit du reste dû", statutPaiement(f0b, [avoir], [enc(30_000, f0)], "2026-11-20") === "payee");
  check("encaissement sur brouillon refusé", await rejet(() => d.creerEncaissement({ ...enc(1, trop), id: undefined } as never), /facture émise/));

  console.log("Livre des recettes et trimestre");
  const demo = await etatDemo();
  const recettes: LigneRecette[] = demo.encaissements.map((e) => ({ ...e, client_nom: demo.clients.find((x) => x.id === e.client_id)!.nom, piece: demo.factures.find((f) => f.id === e.facture_id)?.numero ?? null }));
  const livre = livreDesRecettes([...recettes].reverse());
  check("livre chronologique", livre.every((e, i) => i === 0 || livre[i - 1].date <= e.date));
  check("sous-total par trimestre", lignesLivre(recettes).filter((l) => l.sousTotal).map((l) => l.sousTotal!.libelle).join(",") === "Total T4 2026");
  check("total T4 2026 = encaissements (245 000 c)", totalTrimestre(demo.encaissements, { annee: 2026, trimestre: 4 }) === 245_000);
  check("total T3 2026 = 0 (facture émise en septembre, payée en octobre)", totalTrimestre(demo.encaissements, { annee: 2026, trimestre: 3 }) === 0);
  check("bornes du T4", bornesTrimestre({ annee: 2026, trimestre: 4 }).join("→") === "2026-10-01→2026-12-31");
  const csv = csvLivre(recettes);
  check("CSV : en-tête, séparateur ; et décimale ,", csv.startsWith("﻿Date;Client;Nature;Montant (EUR);Mode de règlement;Pièce") && csv.includes(";1450,00;Virement;F-2026-001"), csv.slice(0, 200));
  check("PDF du livre : total présent", texte(pdfLivre(recettes, "Axel Remillat EI", "2026")).includes(winAnsi("Total T4 2026")));

  console.log("URSSAF, ACRE, seuils");
  check("31/01/2027 (dimanche) reporté au lundi 01/02/2027", dateLimite({ annee: 2026, trimestre: 4 }) === "2027-02-01");
  check("31/07/2027 (samedi) reporté au 02/08/2027", dateLimite({ annee: 2027, trimestre: 2 }) === "2027-08-02");
  check("jour férié (01/05/2028, lundi) reporté", jourOuvre("2028-05-01") === "2028-05-02");
  check("fin de l'ACRE pour un début au 01/09/2026 : 30/06/2027", finAcre("2026-09-01") === "2027-06-30");
  const ps = periodes("2026-09-01", "2027-12-31");
  check("1re déclaration : 01/09/2026 → 31/12/2026, avant le 01/02/2027", ps[0].debut === "2026-09-01" && ps[0].fin === "2026-12-31" && ps[0].limite === "2027-02-01" && ps[0].premiere);
  check("puis un trimestre par déclaration", ps[1].debut === "2027-01-01" && ps[1].fin === "2027-03-31" && ps[1].limite === "2027-04-30");
  const est = estimer(demo.encaissements, ps[0], { active: true, fin: finAcre("2026-09-01") });
  check(`estimation sous ACRE : 19,2 % + CFP 0,2 % (${euros(est.total)})`, est.acre && Math.abs(est.taux - 0.192) < 1e-9 && est.total === Math.round(245_000 * 0.192) + Math.round(245_000 * 0.002));
  const apres = estimer(demo.encaissements, { debut: "2027-07-01", fin: "2027-09-30" }, { active: true, fin: "2027-06-30" });
  check("après l'ACRE : 25,6 %", !apres.acre && apres.taux === COMPTA_CONFIG.tauxCotisations);
  const prorata = plafondProratise(COMPTA_CONFIG.plafondMicro, "2026-09-01", 2026);
  check(`plafond micro proratisé 2026 (${euros(prorata)})`, prorata === Math.round((8_360_000 * 122) / 365));
  check("plafond plein en 2027", plafondProratise(COMPTA_CONFIG.plafondMicro, "2026-09-01", 2027) === 8_360_000);
  const j = jauge(3_000_000, COMPTA_CONFIG.seuilTva);
  check("jauge TVA : alerte à 80 %", j.alerte && !j.depasse && !jauge(2_999_000, COMPTA_CONFIG.seuilTva).alerte);
  check("lecture des montants", lireEuros("1 234,5 €") === 123_450 && lireEuros("abc") === null && euros(123_450) === "1 234,50 €");

  console.log("PDF : mentions obligatoires");
  const fPro = demo.factures.find((f) => f.numero === "F-2026-001") as Facture & { emetteur: Emetteur; client: ClientFige };
  const pdf = texte(pdfPiece({ genre: "facture", facture: fPro }));
  const attendues = [MENTIONS_PAIEMENT.franchiseTva, "Escompte pour paiement anticip", "3 fois le taux d'int", "exigibles sans rappel", "40 ", "SIRET 109 144 477 00014", "Axel Remillat EI", "F-2026-001", "Date d", "chéance de paiement", "Date de la prestation", "Prix unitaire HT", "Total HT", "Net ", "Boulangerie Exemple (fictive)"];
  const manquantes = attendues.filter((m) => !pdf.includes(winAnsi(m)));
  check("facture pro : toutes les mentions présentes", manquantes.length === 0, manquantes);
  check("PDF valide (en-tête, xref, %%EOF)", pdf.startsWith("%PDF-1.4") && pdf.includes("xref") && pdf.trimEnd().endsWith("%%EOF"));
  const fPart = demo.factures.find((f) => f.client?.professionnel === false) as Facture & { emetteur: Emetteur; client: ClientFige };
  check("particulier : pas d'indemnité de 40 €", !texte(pdfPiece({ genre: "facture", facture: fPart })).includes(winAnsi("Indemnité forfaitaire")));
  const fAvoir = demo.factures.find((f) => f.type === "avoir") as Facture & { emetteur: Emetteur; client: ClientFige };
  const pdfAvoir = texte(pdfPiece({ genre: "facture", facture: fAvoir, origine: "F-2026-002" }));
  check("avoir : titre, n° d'origine, franchise TVA", ["AVOIR", "A-2026-001", "F-2026-002", MENTIONS_PAIEMENT.franchiseTva].every((m) => pdfAvoir.includes(winAnsi(m))));
  const devis = demo.devis[0];
  const pdfDevis = texte(pdfPiece({ genre: "devis", devis, emetteur: { ...demo.parametres! }, client: { ...demo.clients.find((x) => x.id === devis.client_id)!, professionnel: true } }));
  check("devis : numéro, validité, bon pour accord, franchise TVA", [devis.numero, "Valable jusqu", "Bon pour accord", MENTIONS_PAIEMENT.franchiseTva].every((m) => pdfDevis.includes(winAnsi(m))));
  check("aujourd'hui de la démo", AUJOURDHUI_DEMO === "2026-11-18");

  console.log("Accès");
  check("COMPTA_EMAIL défini : seul ce compte", compteAutorise("Axel@Exemple.fr", "axel@exemple.fr") && !compteAutorise("autre@exemple.fr", "axel@exemple.fr") && !compteAutorise(null, "axel@exemple.fr"));
  check("COMPTA_EMAIL absent : tout compte connecté (la RLS cloisonne)", compteAutorise("x@y.fr", undefined));
  check("démo sans session : seulement hors production", isComptaDemoPath("/compta/factures", { COMPTA_DEMO: "1", NODE_ENV: "development" }) && !isComptaDemoPath("/compta", { COMPTA_DEMO: "1", NODE_ENV: "production" }));
  check("démo : jamais hors de /compta", !isComptaDemoPath("/aujourdhui", { COMPTA_DEMO: "1", NODE_ENV: "development" }) && !isComptaDemoPath("/comptable", { COMPTA_DEMO: "1", NODE_ENV: "development" }));

  if (failures) {
    console.log(`\n${failures} échec(s)`);
    process.exit(1);
  }
  console.log("\nCompta : tout est vert");
}

void main();
