/**
 * CRM du Web des Artisans (Cowork #117) : saisie, étapes, chronologie, prochaine action, tâches du jour, recherche,
 * kanban, SIREN gratuit, données pour la plateforme. Sans réseau ni base (dépôt en mémoire). `npm run test:crm`
 */
import { aujourdhuiParis, changementEtape, filtrerCommerces, nettoyerInstagram, nettoyerSaisie, nettoyerSiren, nettoyerUrl, parEtape, tachesDuJour, valeursDistinctes } from "../lib/crm/logique";
import { ETAPES, type Commerce } from "../lib/crm/types";
import { lireCandidats } from "../lib/crm/siren";
import { creerClientPlateforme, donneesPourPlateforme, plateformeBranchee } from "../lib/crm/plateforme";
import { depotMemoire, reinitialiserDemo } from "../lib/crm/memoire";
import { lignesCommerces, planImport } from "../lib/crm/import";
import { ongletArrivee, ongletsAffiches } from "../lib/opportunities/tabs";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const base = (p: Partial<Commerce> & { nom: string }): Commerce => ({
  id: p.nom, metier: null, ville: null, adresse: null, telephone: null, instagram: null, fiche_google: null, site_existant: null, site_url: null,
  siren: null, contact_prenom: null, contact_role: null, canal: "terrain", maquette_url: null, notes: null, etape: "a_contacter", motif_perte: null,
  etape_le: "2026-11-01T00:00:00Z", prochaine_action: null, prochaine_action_le: null, offre_id: null, montant_devis: null, date_signature: null,
  accord_demo: false, accord_demo_le: null, prospect_id: null, plateforme_client_id: null, archivee_le: null, created_at: "", updated_at: "", ...p,
});

async function main() {
  console.log("saisie d'une fiche (30 s sur le téléphone)");
  const s = nettoyerSaisie({ nom: "  Boulangerie du Pont ", ville: "Vizille", telephone: "04 00 00 00 01", metier: "", canal: "terrain" }, true);
  check("nom obligatoire et nettoyé", s.valeurs.nom === "Boulangerie du Pont" && Object.keys(s.erreurs).length === 0, s);
  check("champ vide → null", s.valeurs.metier === null);
  check("seuls les champs saisis sont renvoyés (pas d'écrasement)", !("siren" in s.valeurs) && !("notes" in s.valeurs));
  check("nom absent refusé à la création", "nom" in nettoyerSaisie({ ville: "La Mure" }, true).erreurs);
  check("modification partielle sans nom acceptée", Object.keys(nettoyerSaisie({ notes: "x" }, false).erreurs).length === 0);
  check("SIREN : 9 chiffres, espaces tolérés", nettoyerSiren("552 100 554") === "552100554" && nettoyerSiren("1234") === null);
  check("SIREN invalide signalé", "siren" in nettoyerSaisie({ siren: "12" }, false).erreurs);
  check("URL sans protocole complétée", nettoyerUrl("optique-des-alpes.fr") === "https://optique-des-alpes.fr/");
  check("URL invalide refusée", "site_url" in nettoyerSaisie({ site_url: "pas une url" }, false).erreurs);
  check("Instagram : @, pseudo ou URL", nettoyerInstagram("instagram.com/meches.ciseaux/") === "@meches.ciseaux" && nettoyerInstagram("meches") === "@meches");
  check("canal hors liste refusé", "canal" in nettoyerSaisie({ canal: "pigeon" }, false).erreurs);
  check("montant « 1 200,50 » lu", nettoyerSaisie({ montant_devis: "1 200,50" }, false).valeurs.montant_devis === 1200.5);
  const accord = nettoyerSaisie({ accord_demo: "on", accord_demo_le: "" }, false).valeurs;
  check("accord de démo coché sans date : date du jour", accord.accord_demo === true && accord.accord_demo_le === aujourdhuiParis(), accord);
  check("accord retiré : date effacée", nettoyerSaisie({ accord_demo: false, accord_demo_le: "2026-11-01" }, false).valeurs.accord_demo_le === null);

  console.log("\nétapes et chronologie");
  const m = new Date("2026-11-18T10:00:00Z");
  const e1 = changementEtape({ etape: "devis_envoye", date_signature: null }, "signe", { maintenant: m });
  check("Devis → Signé : événement « etape » et date de signature", "champs" in e1 && e1.champs.etape === "signe" && e1.champs.date_signature === "2026-11-18" && e1.evenement.contenu === "Devis envoyé → Signé", e1);
  const e2 = changementEtape({ etape: "rdv", date_signature: null }, "perdu", {});
  check("Perdu sans motif refusé", "erreur" in e2);
  const e3 = changementEtape({ etape: "rdv", date_signature: null }, "perdu", { motif: "Trop cher" });
  check("Perdu avec motif : motif gardé et tracé", "champs" in e3 && e3.champs.motif_perte === "Trop cher" && e3.evenement.meta.motif === "Trop cher", e3);
  check("même étape : rien à faire", "identique" in changementEtape({ etape: "rdv", date_signature: null }, "rdv"));
  const e4 = changementEtape({ etape: "devis_envoye", date_signature: "2026-10-01" }, "signe", { maintenant: m });
  check("date de signature déjà saisie conservée", "champs" in e4 && !("date_signature" in e4.champs));
  check("étape inconnue refusée", "erreur" in changementEtape({ etape: "rdv", date_signature: null }, "xyz" as never));

  console.log("\nprochaine action et « Aujourd'hui »");
  const jour = new Date("2026-11-18T08:00:00Z");
  const liste = [
    base({ nom: "A", prochaine_action_le: "2026-11-18", etape: "rdv" }),
    base({ nom: "B", prochaine_action_le: "2026-11-15", etape: "devis_envoye" }),
    base({ nom: "C", prochaine_action_le: "2026-11-20" }),
    base({ nom: "D", prochaine_action_le: "2026-11-10", etape: "perdu" }),
    base({ nom: "E", prochaine_action_le: "2026-11-01", archivee_le: "2026-11-02T00:00:00Z" }),
    base({ nom: "F" }),
  ];
  const t = tachesDuJour(liste, jour);
  check("dues aujourd'hui et en retard seulement", t.map((x) => x.commerce.nom).join(",") === "B,A", t.map((x) => x.commerce.nom));
  check("retard en jours", t[0].retard === 3 && t[1].retard === 0);
  check("perdues, archivées et sans date exclues", !t.some((x) => ["C", "D", "E", "F"].includes(x.commerce.nom)));
  check("date du jour à Paris (23 h 30 UTC = lendemain)", aujourdhuiParis(new Date("2026-11-18T23:30:00Z")) === "2026-11-19");

  console.log("\nrecherche instantanée et filtres");
  const c = [
    base({ nom: "Pâtisserie Lumière", metier: "Pâtisserie", ville: "La Mure", telephone: "04 76 11 22 33" }),
    base({ nom: "Garage du Drac", metier: "Garage", ville: "Vif", etape: "rdv" }),
    base({ nom: "Ancienne", archivee_le: "2026-01-01T00:00:00Z" }),
  ];
  check("sans accents ni casse", filtrerCommerces(c, { q: "patisserie" }).length === 1);
  check("plusieurs mots (nom + ville)", filtrerCommerces(c, { q: "drac vif" }).length === 1);
  check("par numéro de téléphone", filtrerCommerces(c, { q: "1122" })[0]?.nom === "Pâtisserie Lumière");
  check("filtre étape", filtrerCommerces(c, { etape: "rdv" }).map((x) => x.nom).join() === "Garage du Drac");
  check("filtre ville sans accents", filtrerCommerces(c, { ville: "la mure" }).length === 1);
  check("archivées masquées par défaut", filtrerCommerces(c, {}).length === 2 && filtrerCommerces(c, { archives: true }).length === 3);
  const k = parEtape(c, ETAPES);
  check("kanban : toutes les colonnes, dans l'ordre", Object.keys(k).join() === ETAPES.map((e) => e.id).join() && k.rdv.length === 1);
  check("valeurs distinctes pour les filtres", valeursDistinctes(c, "ville").join() === "La Mure,Vif");

  console.log("\ndépôt (mémoire) : création, déplacement, chronologie");
  reinitialiserDemo();
  const d = depotMemoire();
  const creee = await d.creer({ nom: "Test Fiche", ville: "Grenoble" });
  check("création : étape « à contacter » par défaut", creee.etape === "a_contacter");
  const passage = changementEtape(creee, "contacte");
  if ("champs" in passage) {
    await d.modifier(creee.id, passage.champs);
    await d.ajouterEvenement(creee.id, passage.evenement);
  }
  await d.ajouterEvenement(creee.id, { type: "appel", contenu: "Rappeler jeudi" });
  const relue = await d.commerce(creee.id);
  const chrono = await d.evenements(creee.id);
  check("déplacement enregistré", relue?.etape === "contacte");
  check("chronologie : 2 événements, le plus récent d'abord", chrono.length === 2 && chrono[0].type === "appel", chrono.map((x) => x.type));
  const optique = (await d.commerces()).find((x) => x.nom === "Optique des Alpes");
  check("démo : Optique des Alpes en ligne", optique?.etape === "en_ligne" && optique.ville === "La Mure");
  check("archiver = masquer (la fiche existe encore)", await (async () => {
    await d.modifier(creee.id, { archivee_le: new Date().toISOString() });
    return !(await d.commerces()).some((x) => x.id === creee.id) && (await d.commerces({ archives: true })).some((x) => x.id === creee.id);
  })());

  console.log("\nSIREN (API Recherche d'entreprises, gratuite)");
  const cand = lireCandidats({ results: [{ siren: "123456789", nom_complet: "OPTIQUE DES ALPES", siege: { libelle_commune: "LA MURE", code_postal: "38350" }, etat_administratif: "A" }, { siren: "abc" }] });
  check("candidats lus, SIREN invalides écartés", cand.length === 1 && cand[0].commune === "LA MURE" && cand[0].enActivite);

  console.log("\nplateforme (préparée, non branchée)");
  const donnees = donneesPourPlateforme(base({ nom: "Optique des Alpes", accord_demo: true, accord_demo_le: "2026-11-18" }), "Essentiel");
  check("données : accord de démonstration et offre transmis", donnees.accordDemonstration.signe && donnees.offre === "Essentiel" && donnees.crmCommerceId === "Optique des Alpes");
  const r = await creerClientPlateforme(donnees);
  check("non branchée : refus propre, sans réseau", !r.ok && r.nonBranche === true);
  check("branchée seulement avec URL et jeton", !plateformeBranchee({}) && plateformeBranchee({ PLATEFORME_API_URL: "x", PLATEFORME_API_TOKEN: "y" }));

  console.log("\nimport initial (simulation par défaut)");
  const pr = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, company_name: `Commerce ${id}`, city: "Grenoble", sector: "Boulangerie", siren: "123456789", website: null, status, ...extra });
  const plan = planImport([], [pr("p1", "repondu"), pr("p2", "en_discussion"), pr("p3", "gagne"), pr("p4", "contacte"), pr("p5", "repondu", { deleted_at: "2026-11-01" })]);
  check("Optique des Alpes en premier, étape en ligne", plan.creer[0].nom === "Optique des Alpes" && plan.creer[0].etape === "en_ligne" && plan.creer[0].contact_prenom === "Guillaume Teissedre");
  check("seuls les prospects intéressés, hors corbeille", plan.creer.map((f) => f.prospect_id).filter(Boolean).join(",") === "p1,p2,p3");
  check("gagné → signé, sinon contacté", plan.creer.find((f) => f.prospect_id === "p3")?.etape === "signe" && plan.creer.find((f) => f.prospect_id === "p1")?.etape === "contacte");
  const replan = planImport([{ nom: "OPTIQUE DES ALPES", ville: "la mure", prospect_id: null }, { nom: "x", ville: null, prospect_id: "p1" }], [pr("p1", "repondu"), pr("p2", "repondu")]);
  check("idempotent : rien de recréé", replan.creer.length === 1 && replan.creer[0].prospect_id === "p2" && replan.ignorees.length === 2, replan);
  const lignes = lignesCommerces(plan.creer.slice(0, 1), "u1");
  check("lignes : user_id posé, champ de rapport retiré", lignes[0].user_id === "u1" && !("origine" in lignes[0]));

  console.log("\nOpportunités : Codeur masqué");
  check("Codeur retiré des onglets", ongletsAffiches(["codeur", "upwork", "comeup"]).join(",") === "upwork,comeup");
  check("Codeur gardé pour une fiche Codeur visée", ongletsAffiches(["codeur", "upwork", "comeup"], "codeur").includes("codeur"));
  check("arrivée : Upwork par défaut", ongletArrivee("codeur", false) === "upwork" && ongletArrivee("codeur", true) === "codeur" && ongletArrivee("comeup", false) === "comeup");

  console.log(failures === 0 ? "\nTous les tests du CRM passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
