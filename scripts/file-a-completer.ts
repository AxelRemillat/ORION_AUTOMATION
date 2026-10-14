/**
 * FILE « À COMPLÉTER » (Cowork #35) — CLASSEMENT EN LECTURE SEULE : chaque fiche, son étiquette
 * bloquante principale, l'action prévue ; contrôle « le nom du contact est-il le propriétaire de
 * l'adresse ? » (RISO FRANCE : f.taoufik@… affiché au nom du dirigeant).
 *
 *   … file-a-completer.js            tableau + détail par fiche
 *   … file-a-completer.js --json     sortie JSON (pour les lots d'action)
 */
import { db, ownerId } from "./quality-live";
import { loadToday } from "@/lib/today/load";
import { flatten } from "@/lib/today/group";
import { ownerMismatch } from "@/lib/contact-finder/owner";

/** Ordre de priorité : la première étiquette présente décide de l'action. */
const PLAN: { tag: string; action: string }[] = [
  { tag: "Email manquant", action: "contact-finder #34 (gratuit) ; 4 fiches Hunter → agent1" },
  { tag: "Email non vérifié", action: "vérification Hunter (0,5 crédit, cache 30 j)" },
  { tag: "Contact à vérifier", action: "nom ↔ propriétaire de l'adresse ; domaine hors site = confirmation d'Axel" },
  { tag: "Site introuvable", action: "laissée, motif : pas de site" },
  { tag: "Profil métier vide", action: "relecture du profil métier (site) avant rédaction" },
  { tag: "Profil à compléter", action: "relecture du profil métier (site) avant rédaction" },
  { tag: "Faits insuffisants", action: "relecture du profil, sinon laissée avec motif" },
  { tag: "À revoir", action: "une régénération (plafond 1 / 7 j), juge à jour" },
  { tag: "Brouillon manquant", action: "une génération, juge à jour" },
];


async function main() {
  const userId = await ownerId();
  const items = flatten((await loadToday(db as never, userId)).groups).filter((item) => item.kind === "a_completer");
  const rows = items.map((item) => {
    const first = PLAN.find((step) => item.tags.includes(step.tag as never));
    return {
      prospectId: item.prospectId,
      name: item.companyName,
      tags: item.tags,
      main: first?.tag ?? "(aucune étiquette bloquante)",
      action: first?.action ?? "à examiner",
      email: item.contact.email,
      contact: item.contact.name,
      kind: item.contact.kind,
      ownerMismatch: ownerMismatch(item.contact.email, item.contact.name),
      website: item.website,
      quality: item.quality ?? null,
      messageId: item.messageId,
      attempts: item.attempts,
    };
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(rows));
    return process.exit(0);
  }
  const by: Record<string, number> = {};
  for (const row of rows) by[row.main] = (by[row.main] ?? 0) + 1;
  console.log(`« À compléter » : ${rows.length} fiche(s)\n`);
  for (const step of PLAN) if (by[step.tag]) console.log(`  ${String(by[step.tag]).padStart(3)}  ${step.tag.padEnd(20)} → ${step.action}`);
  console.log("");
  for (const row of rows) {
    console.log(`· ${row.name} | ${row.main} | ${row.tags.join(", ")} | ${row.email ?? "—"}${row.contact ? ` (${row.contact})` : ""}${row.ownerMismatch ? " | NOM ≠ PROPRIÉTAIRE DE L'ADRESSE" : ""}${row.quality !== null ? ` | note ${row.quality}` : ""}`);
  }
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
