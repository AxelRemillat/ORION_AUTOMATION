// Tests SQL de la comptabilité (Cowork #70) sur un Postgres NU : base jetable créée puis supprimée, émulation Supabase,
// migrations compta_* seulement. Numérotation sans trou (y compris 30 émissions SIMULTANÉES et une émission annulée),
// facture émise immuable, avoir, total recalculé, encaissement, devis → facture, journal, RLS entre deux comptes.
//
// Local : COMPTA_PG_URL=postgres://postgres@localhost:5455/postgres node scripts/compta-sql/compta-sql.test.mjs
// CI : workflow compta-sql.yml (service postgres:17). JAMAIS contre la base de production.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.COMPTA_PG_URL;
if (!URL || /supabase\.(co|com)/.test(URL)) {
  console.error("COMPTA_PG_URL absente ou pointant vers Supabase : refusé (base jetable locale ou CI seulement).");
  process.exit(1);
}
const PSQL = process.env.PSQL ?? "psql";
const BASE = `compta_test_${Date.now()}`;
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const urlBase = (db) => URL.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);

function psql(sql, { db = BASE, uid = null } = {}) {
  const prelude = uid ? `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);\n` : "";
  return new Promise((resolve, reject) => {
    const p = spawn(PSQL, ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", urlBase(db)], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve(out.split(/\r?\n/).filter((l) => l && l !== "SET" && l !== uid)) : reject(new Error(err.trim()))));
    p.stdin.end(prelude + sql);
  });
}
const une = async (sql, o) => (await psql(sql, o)).at(-1);
const refuse = async (sql, o, motif) => {
  try {
    await psql(sql, o);
    return false;
  } catch (e) {
    return motif.test(String(e.message));
  }
};

let echecs = 0;
const verifier = (nom, ok) => {
  console.log(`${ok ? "✓" : "✗"} ${nom}`);
  if (!ok) echecs++;
};

const brouillon = (total = 10000, uid = A) =>
  une(`insert into public.compta_factures (client_id, objet, lignes, date_prestation)
       values ((select id from public.compta_clients limit 1), 'Site vitrine', '[{"designation":"Site","quantite":1,"prix_unitaire":${total}}]', 'novembre 2026') returning id;`, { uid });

try {
  await psql(`create database ${BASE};`, { db: "postgres" });
  await psql(readFileSync(join("scripts", "compta-sql", "emulation-supabase.sql"), "utf8"));
  // Ordre réel de main : les migrations crm_ (#208) passent avant les compta_ (crm_ref référence crm_commerces).
  const migrations = readdirSync(join("supabase", "migrations")).filter((n) => /_(crm|compta)_/.test(n)).sort();
  verifier("ordre : toutes les crm_ avant les compta_", migrations.findIndex((n) => /_compta_/.test(n)) > migrations.findLastIndex((n) => /_crm_/.test(n)));
  for (const f of migrations) {
    await psql(readFileSync(join("supabase", "migrations", f), "utf8"));
    await psql(readFileSync(join("supabase", "migrations", f), "utf8")); // idempotente : rejouée sans erreur
  }
  verifier("migrations crm puis compta appliquées deux fois (idempotentes)", true);

  // Émettre sans paramètres : refusé, aucun numéro consommé.
  await une(`insert into public.compta_clients (nom, professionnel) values ('Client Test SARL', true) returning id;`, { uid: A });
  const f0 = await brouillon();
  verifier("émission refusée sans nom/adresse/SIRET", await refuse(`select public.compta_emettre('${f0}');`, { uid: A }, /paramètres/));
  await psql(`insert into public.compta_parametres (nom, adresse, siret) values ('Émetteur Test', '1 rue de l''Exemple, 75000 Paris', '000 000 000 00000');`, { uid: A });

  // Total recalculé par la base.
  const tot = await une(`update public.compta_factures set total = 1, lignes = '[{"designation":"a","quantite":2.5,"prix_unitaire":1000},{"designation":"b","quantite":1,"prix_unitaire":333}]' where id = '${f0}' returning total;`, { uid: A });
  verifier(`total recalculé à partir des lignes (${tot} = 2833)`, tot === "2833");

  // 30 émissions simultanées : F-AAAA-001 à 030, sans trou ni doublon.
  const ids = [f0];
  for (let i = 0; i < 29; i++) ids.push(await brouillon());
  const numeros = await Promise.all(ids.map((id) => une(`select numero from public.compta_emettre('${id}');`, { uid: A })));
  const annee = new Date().getFullYear();
  const attendus = Array.from({ length: 30 }, (_, i) => `F-${annee}-${String(i + 1).padStart(3, "0")}`);
  verifier(`30 émissions simultanées → ${[...numeros].sort()[0]} … ${[...numeros].sort().at(-1)} sans trou ni doublon`, JSON.stringify([...numeros].sort()) === JSON.stringify(attendus));

  // Émission annulée (rollback) et émission refusée (0 €) : le numéro suivant reste contigu.
  const fAnnulee = await brouillon();
  await psql(`begin; select public.compta_emettre('${fAnnulee}'); rollback;`, { uid: A });
  const fZero = await brouillon(0);
  await refuse(`select public.compta_emettre('${fZero}');`, { uid: A }, /0 €/);
  const n31 = await une(`select numero from public.compta_emettre('${fAnnulee}');`, { uid: A });
  verifier(`après un rollback et un refus, numéro suivant = ${n31}`, n31 === `F-${annee}-031`);

  // Immuabilité.
  verifier("facture émise : modification refusée", await refuse(`update public.compta_factures set objet = 'x' where id = '${f0}';`, { uid: A }, /plus modifiable/));
  verifier("facture émise : suppression refusée", await refuse(`delete from public.compta_factures where id = '${f0}';`, { uid: A }, /ne se supprime pas/));
  verifier("émission directe par UPDATE refusée", await refuse(`update public.compta_factures set etat = 'emise', numero = 'F-1-1', date_emission = current_date where id = '${fZero}';`, { uid: A }, /compta_emettre/));
  verifier("insertion directe en « émise » refusée", await refuse(`insert into public.compta_factures (client_id, etat, numero, date_emission) values ((select id from public.compta_clients limit 1), 'emise', 'F-2026-999', current_date);`, { uid: A }, /brouillon/));

  // Avoir.
  const av = await une(`insert into public.compta_factures (type, client_id, objet, lignes, facture_origine_id, motif_avoir)
    values ('avoir', (select id from public.compta_clients limit 1), 'Avoir', '[{"designation":"Remise","quantite":1,"prix_unitaire":500}]', '${ids[1]}', 'Remise commerciale') returning id;`, { uid: A });
  const nAv = await une(`select numero from public.compta_emettre('${av}');`, { uid: A });
  verifier(`avoir émis dans sa propre série (${nAv})`, nAv === `A-${annee}-001`);
  const avTrop = await une(`insert into public.compta_factures (type, client_id, objet, lignes, facture_origine_id) values ('avoir', (select id from public.compta_clients limit 1), 'Avoir', '[{"designation":"x","quantite":1,"prix_unitaire":9600}]', '${ids[1]}') returning id;`, { uid: A });
  verifier("avoir supérieur au restant refusé", await refuse(`select public.compta_emettre('${avTrop}');`, { uid: A }, /dépasse/));

  // Encaissements.
  verifier("encaissement sur un brouillon refusé", await refuse(`insert into public.compta_encaissements (date, montant, moyen, facture_id, client_id, nature) values (current_date, 100, 'virement', '${fZero}', (select id from public.compta_clients limit 1), 'x');`, { uid: A }, /facture émise/));
  await psql(`insert into public.compta_encaissements (date, montant, moyen, facture_id, client_id, nature) values (current_date, 5000, 'virement', '${ids[2]}', (select id from public.compta_clients limit 1), 'Site vitrine');`, { uid: A });
  verifier("encaissement sur une facture émise accepté", true);

  // Devis → facture.
  const dv = await une(`insert into public.compta_devis (client_id, objet, lignes) values ((select id from public.compta_clients limit 1), 'Refonte', '[{"designation":"Refonte","quantite":1,"prix_unitaire":120000}]') returning numero;`, { uid: A });
  verifier(`devis numéroté à la création (${dv})`, dv === `D-${annee}-001`);
  const fDv = await une(`select public.compta_devis_vers_facture((select id from public.compta_devis where numero = '${dv}'));`, { uid: A });
  const etat = await une(`select d.statut || '/' || f.etat || '/' || f.total from public.compta_devis d join public.compta_factures f on f.id = d.facture_id where d.numero = '${dv}';`, { uid: A });
  verifier(`devis → facture brouillon en un clic (${etat})`, etat === "accepte/brouillon/120000" && !!fDv);

  // Journal.
  const emissions = await une(`select count(*) from public.compta_journal where action = 'emission';`, { uid: A });
  verifier(`journal : ${emissions} émissions tracées`, emissions === "32");

  // RLS : le compte B ne voit ni ne touche rien de A.
  verifier("RLS : B ne voit aucune facture de A", (await une(`select count(*) from public.compta_factures;`, { uid: B })) === "0");
  verifier("RLS : B ne peut pas émettre une facture de A", await refuse(`select public.compta_emettre('${fZero}');`, { uid: B }, /introuvable/));
  verifier("RLS : B ne peut pas modifier un brouillon de A", (await psql(`update public.compta_factures set objet = 'pirate' where id = '${fZero}' returning id;`, { uid: B })).length === 0);
  verifier("anonyme : aucun accès", await refuse(`set role anon; select count(*) from public.compta_factures;`, {}, /permission denied/));

  // Liaison avec la fiche CRM (schéma réel de main) : référence valide acceptée, inconnue refusée, fiche supprimée → lien vidé.
  const commerce = await une(`insert into public.crm_commerces (nom) values ('Boulangerie CRM') returning id;`, { uid: A });
  const lie = await une(`insert into public.compta_clients (nom, crm_ref) values ('Client lié', '${commerce}') returning id;`, { uid: A });
  verifier("crm_ref : client compta lié à une fiche crm_commerces", !!lie);
  verifier("crm_ref : fiche CRM inexistante refusée", await refuse(`insert into public.compta_clients (nom, crm_ref) values ('Fantôme', gen_random_uuid());`, { uid: A }, /foreign key|clé étrangère/));
  await psql(`delete from public.crm_commerces where id = '${commerce}';`);
  verifier("crm_ref : fiche CRM supprimée → lien remis à vide", (await une(`select coalesce(crm_ref::text, 'vide') from public.compta_clients where id = '${lie}';`, { uid: A })) === "vide");
} catch (e) {
  console.error("✗ erreur inattendue :", e.message);
  echecs++;
} finally {
  await psql(`drop database if exists ${BASE} with (force);`, { db: "postgres" }).catch(() => {});
}
console.log(echecs ? `\n${echecs} échec(s)` : "\nTests SQL compta : tout est vert");
process.exit(echecs ? 1 : 0);
