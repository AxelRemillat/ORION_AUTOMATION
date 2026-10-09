/**
 * Contacts NOMINATIFS selon le sujet du mail (Cowork, 06/10/2026).
 * Fixtures seulement : Hunter simulé, fausse base, aucun crédit, aucun envoi.
 * `npm run test:nominatif`
 */
import { contactLine, emailFromPattern, findNominativeContact, targetRoles, topicOf, type HunterPerson, type NominativeDeps, type VerifierStatus } from "../lib/contact-finder/nominative";
import { addresseeHint, firstGiven, ineligibility, nominativeShare, upgradeToNominative, NOMINATIVE_VERSION, type UpgradeProspect } from "../lib/contact-finder/upgrade";
import { extractPeople } from "../lib/contact-finder/site-people";
import { groupToday, type RawTodayItem } from "../lib/today/group";
import { planSchedule } from "../lib/today/plan";
import { buildQualityGreeting } from "../lib/emails/quality/greeting";
import type { Db } from "../lib/trash/scope";
import { FakeDb } from "./fake-supabase";
import { isRoleBox } from "../lib/contact-finder/role-boxes";
import { classifyEmail, extractEmails } from "../lib/contact-finder/extract";
import { checkSendRules } from "../lib/outbox/send";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const person = (email: string, position: string | null, confidence: number, over: Partial<HunterPerson> = {}): HunterPerson => {
  const [first, last] = email.split("@")[0].split(".");
  return { email, type: "personal", firstName: first ?? null, lastName: last ?? null, position, confidence, department: null, seniority: null, ...over };
};

/** Faux Hunter : compte ses appels. */
function hunter(options: { people?: HunterPerson[]; pattern?: string | null; finder?: { email: string; score: number } | null; verdicts?: Record<string, { status: VerifierStatus; score: number | null }> } = {}) {
  const calls = { domainSearch: 0, finder: 0, verifier: 0, departments: [] as string[] };
  const deps: NominativeDeps = {
    async domainSearch(_domain, filters) {
      calls.domainSearch += 1;
      calls.departments = filters.departments;
      return { people: options.people ?? [], pattern: options.pattern ?? null };
    },
    async emailFinder() {
      calls.finder += 1;
      return options.finder ? { ...options.finder, position: null } : null;
    },
    async verify(email) {
      calls.verifier += 1;
      return options.verdicts?.[email] ?? { status: "valid", score: 95 };
    },
  };
  return { calls, deps };
}

const LEADER = { firstName: "Pierre", lastName: "Durand" };

async function main() {
  console.log("\n1. Rôle visé selon le sujet du mail");
  {
    const keys = (pain: string, headcount: number | null = 50) => targetRoles(pain, headcount).map((role) => role.key).join(",");
    check("devis → commercial, ADV, dirigeant", keys("production des devis") === "commercial,adv,dirigeant", keys("production des devis"));
    check("factures / relances → DAF, comptable, dirigeant", keys("édition et suivi des factures, relances de paiement") === "finance,comptable,dirigeant");
    check("tri des e-mails / commandes reçues → service client, ADV, office, dirigeant", keys("tri des demandes et commandes reçues par e-mail") === "service_client,adv,office,dirigeant", keys("tri des demandes et commandes reçues par e-mail"));
    check("comptes rendus / fichier clients → dirigeant, administratif", keys("comptes rendus de chantier") === "dirigeant,admin" && keys("nettoyage du fichier clients") === "dirigeant,admin");
    check("< 20 salariés → dirigeant d'abord, quel que soit le sujet", keys("suivi des factures", 12) === "dirigeant,finance,comptable");
    check("sujet inconnu → dirigeant", keys("autre chose") === "dirigeant" && topicOf(null) === "general");
  }

  console.log("\n2. Stratégie Hunter");
  {
    const daf = hunter({ people: [person("jeanne.martin@acme.fr", "Directrice administrative et financière", 92), person("paul.petit@acme.fr", "Commercial", 99), person("contact@acme.fr", null, 99, { type: "generic" })] });
    const out = await findNominativeContact({ domain: "acme.fr", pain: "relances de factures impayées", headcount: 60, leader: LEADER }, daf.deps);
    check("factures : la DAF trouvée par Domain Search, vérifiée « valid »", out.contact?.email === "jeanne.martin@acme.fr" && out.contact.roleKey === "finance" && out.contact.source === "hunter:domain-search", out.contact);
    check("… départements filtrés (finance, management, executive)", ["finance", "management", "executive"].every((dep) => daf.calls.departments.includes(dep)), daf.calls.departments);
    check("… 1 recherche + 1 vérification, pas d'Email Finder (crédit inutile)", daf.calls.domainSearch === 1 && daf.calls.verifier === 1 && daf.calls.finder === 0, daf.calls);

    const weak = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 70)], finder: { email: "pierre.durand@acme.fr", score: 88 } });
    const fallback = await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 60, leader: LEADER }, weak.deps);
    check("confiance < 80 ignorée → Email Finder sur le dirigeant", fallback.contact?.email === "pierre.durand@acme.fr" && fallback.contact.roleKey === "dirigeant" && fallback.contact.source === "hunter:email-finder", fallback.contact);

    const acceptAll = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 85)], verdicts: { "jeanne.martin@acme.fr": { status: "accept_all", score: 85 } } });
    const refused = await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 60, leader: null }, acceptAll.deps);
    check("accept_all à 85 : refusé → le générique reste", refused.contact === null, refused);
    const sure = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 93)], verdicts: { "jeanne.martin@acme.fr": { status: "accept_all", score: 80 } } });
    check("accept_all avec confiance ≥ 90 : gardé", (await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 60, leader: null }, sure.deps)).contact?.verifier === "accept_all");

    const failedPick = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 95)], finder: { email: "pierre.durand@acme.fr", score: 92 }, verdicts: { "jeanne.martin@acme.fr": { status: "invalid", score: 10 } } });
    const second = await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 60, leader: LEADER }, failedPick.deps);
    check("DAF « invalid » → repli sur le dirigeant (Email Finder)", second.contact?.email === "pierre.durand@acme.fr" && failedPick.calls.verifier === 2, second);

    const small = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 95), person("pdurand@acme.fr", null, 90, { firstName: "Pierre", lastName: "Durand" })] });
    const tiny = await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 8, leader: LEADER }, small.deps);
    check("< 20 salariés : le dirigeant (reconnu par son nom) passe devant la DAF", tiny.contact?.email === "pdurand@acme.fr" && tiny.contact.roleKey === "dirigeant", tiny.contact);

    const dnc = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 95)] });
    const blocked = await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 60, leader: null, blocked: ["Jeanne.Martin@acme.fr"] }, dnc.deps);
    check("adresse « ne plus contacter » : jamais retenue", blocked.contact === null && dnc.calls.verifier === 0, blocked);
  }

  console.log("\n3. Rattrapage d'une fiche (base simulée)");
  {
    const base: UpgradeProspect = {
      id: "p1", user_id: "u1", company_name: "ACME", email: "contact@acme.fr", email_type: "generique", website: "https://acme.fr",
      contact_found_by: "site:mentions-legales", do_not_contact: false, deleted_at: null, pain_point: "édition et suivi des factures", brief: null,
      key_figures: { opposition_checked: true, leader_person: "Pierre DURAND", headcount: 45 },
    };
    const seed = (prospect: UpgradeProspect, messages: Record<string, unknown>[] = []) => {
      const fake = new FakeDb({ prospects: [{ ...prospect }, { id: "p-stop", user_id: "u1", email: "ex@autre.fr", do_not_contact: true }], messages, prospect_events: [] } as Record<string, Record<string, unknown>[]>);
      return { fake, db: fake as unknown as Db };
    };
    const intro = (over: Record<string, unknown> = {}) => ({ id: "m1", user_id: "u1", prospect_id: "p1", type: "intro", status: "draft", send_status: "draft", validated_at: null, edited_by_hand: false, scheduled_at: null, deleted_at: null, ...over });
    const NOW = new Date("2026-10-06T15:00:00Z");

    const { fake, db } = seed(base, [intro()]);
    const web = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 94)] });
    const result = await upgradeToNominative(db, base, web.deps, { now: NOW });
    const row = fake.rows("prospects")[0];
    check("générique → nominatif : adresse, nom, poste, source enregistrés", result.status === "upgraded" && row.email === "jeanne.martin@acme.fr" && row.email_type === "nominatif" && row.contact_name === "jeanne martin" && row.contact_role === "DAF" && row.contact_source === "hunter:domain-search", row);
    check("brouillon libre marqué « à régénérer » (pas régénéré ici)", Boolean(fake.rows("messages")[0].regenerate_reason) && result.flagged === 1, fake.rows("messages")[0]);
    check("historique : contact tracé", fake.rows("prospect_events").some((event) => event.kind === "contact"));

    const locked = async (label: string, over: Record<string, unknown>) => {
      const { db: lockedDb } = seed(base, [intro(over)]);
      const spy = hunter({ people: [person("jeanne.martin@acme.fr", "DAF", 94)] });
      const out = await upgradeToNominative(lockedDb, base, spy.deps, { now: NOW });
      check(`${label} : rien ne bouge, 0 crédit`, out.status === "skipped" && spy.calls.domainSearch === 0, out.reason);
    };
    await locked("brouillon validé", { validated_at: "2026-10-06T08:00:00Z" });
    await locked("brouillon programmé", { send_status: "scheduled", scheduled_at: "2026-10-07T07:00:00Z" });
    await locked("brouillon retouché à la main", { edited_by_hand: true });
    await locked("fiche déjà contactée", { status: "sent", send_status: "sent" });

    const refused = (label: string, over: Partial<UpgradeProspect>, expected: RegExp) =>
      check(`${label} : écartée`, expected.test(ineligibility({ ...base, ...over }, NOW) ?? ""), ineligibility({ ...base, ...over }, NOW));
    refused("opposée (INPI)", { key_figures: { ...base.key_figures, refuses_prospecting: true } }, /opposée/);
    refused("opposition non vérifiée", { key_figures: { leader_person: "Pierre DURAND" } }, /non vérifiée/);
    refused("« ne plus contacter »", { do_not_contact: true }, /ne plus contacter/);
    refused("adresse saisie à la main", { contact_found_by: null, email_type: null }, /main/);
    refused("déjà nominative", { email: "pierre.durand@acme.fr", email_type: "nominatif" }, /déjà nominative/);

    const { fake: none, db: noneDb } = seed(base, [intro()]);
    const empty = hunter({ people: [] });
    const kept = await upgradeToNominative(noneDb, { ...base, key_figures: { ...base.key_figures, leader_person: null } }, empty.deps, { now: NOW });
    check("rien de sûr : le générique reste, la recherche est datée", kept.status === "kept" && none.rows("prospects")[0].email === "contact@acme.fr" && Boolean((none.rows("prospects")[0].key_figures as Record<string, { checked_at?: string }>).nominative?.checked_at), kept);
    const again = ineligibility(none.rows("prospects")[0] as unknown as UpgradeProspect, NOW);
    check("… pas de nouvelle recherche avant 90 jours", /90 jours/.test(again ?? ""), again);

    check("part nominative du stock", JSON.stringify(nominativeShare([{ email: "a@x.fr", email_type: "generique" }, { email: "jean.dupont@x.fr", email_type: "nominatif" }, { email: null, email_type: null }])) === '{"nominative":1,"total":2}');
  }

  console.log("\n4. Cohérence mail ↔ destinataire");
  {
    check("fiche : « Contact : Prénom Nom — Poste (Hunter, confiance 94 %) »", contactLine({ name: "Jeanne Martin", role: "DAF", source: "hunter:domain-search", confidence: 94 }) === "Jeanne Martin — DAF (Hunter, confiance 94 %)");
    const greeting = (contactIsRecipient: boolean) => buildQualityGreeting({ email: "jmartin@acme.fr", leaderPerson: "Pierre DURAND", contactName: "Sophie Martin", contactIsRecipient });
    check("salutation : la personne contactée, pas le dirigeant", greeting(true) === "Bonjour Madame Martin,", greeting(true));
    check("(avant : « jmartin@ » ne donnait ni prénom ni civilité)", greeting(false) === "Bonjour,", greeting(false));
    const generic = buildQualityGreeting({ email: "contact@acme.fr", leaderPerson: "Pierre DURAND", contactName: null });
    check("adresse générique : le dirigeant reste salué (inchangé)", generic === "Bonjour Monsieur Durand,", generic);
  }

  console.log("\n5. Noms du site, schéma d'adresse (#32)");
  {
    check("schéma {first}.{last} : noms composés et particules", emailFromPattern("{first}.{last}", "Jean-Pierre", "Le Gall", "acme.fr") === "jean-pierre.legall@acme.fr", emailFromPattern("{first}.{last}", "Jean-Pierre", "Le Gall", "acme.fr"));
    check("schéma {f}{last}, accents retirés", emailFromPattern("{f}{last}", "Émilie", "Durand", "Acme.fr") === "edurand@acme.fr");
    check("schéma inconnu : rien de deviné", emailFromPattern(null, "Jean", "Dupont", "acme.fr") === null && emailFromPattern("contact", "Jean", "Dupont", "acme.fr") === null);

    const html = `<html><body>
      <h2>Notre équipe</h2>
      <div class="card"><h3>Sophie Martin</h3><p>Responsable ADV</p></div>
      <div class="card"><h3>Marc LEFEBVRE</h3><p>Directeur commercial</p></div>
      <p>Service Commercial – contact@acme.fr</p>
      <p>Directeur de la publication : M. Pierre Durand</p>
      <p>Hébergeur : OVH SAS</p>
    </body></html>`;
    const people = extractPeople(html, "https://acme.fr/equipe");
    const names = people.map((item) => `${item.firstName} ${item.lastName} — ${item.role}`);
    check("carte d'équipe (nom puis fonction) lue", names.includes("Sophie Martin — Responsable ADV") && names.includes("Marc LEFEBVRE — Directeur commercial"), names);
    check("mentions légales : « Directeur de la publication : M. Pierre Durand »", people.some((item) => item.lastName === "Durand" && /publication/i.test(item.role)), names);
    check("« Service Commercial » n'est pas une personne", !people.some((item) => /service/i.test(item.firstName)), names);

    const site = [
      { firstName: "Sophie", lastName: "Martin", role: "Responsable ADV", url: "https://acme.fr/equipe" },
      { firstName: "Marc", lastName: "Lefebvre", role: "Directeur commercial", url: "https://acme.fr/equipe" },
    ];
    const viaPattern = hunter({ people: [], pattern: "{first}.{last}" });
    const devis = await findNominativeContact({ domain: "acme.fr", pain: "production des devis", headcount: 60, leader: LEADER, sitePeople: site }, viaPattern.deps);
    check("devis : le directeur commercial du site, adresse par le schéma, VÉRIFIÉE", devis.contact?.email === "marc.lefebvre@acme.fr" && devis.contact.source === "hunter:pattern" && devis.contact.verifier === "valid", devis.contact);
    check("… sans Email Finder (le schéma suffit)", viaPattern.calls.finder === 0 && viaPattern.calls.verifier === 1, viaPattern.calls);

    const bad = hunter({ people: [], pattern: "{first}.{last}", verdicts: { "marc.lefebvre@acme.fr": { status: "invalid", score: 0 } } });
    const next = await findNominativeContact({ domain: "acme.fr", pain: "production des devis", headcount: 60, leader: LEADER, sitePeople: site }, bad.deps);
    check("adresse devinée « invalid » : jamais gardée, candidat suivant (ADV)", next.contact?.email === "sophie.martin@acme.fr" && next.contact.roleKey === "adv", next.contact);

    const silent = hunter({ people: [], pattern: "{first}.{last}", verdicts: { "marc.lefebvre@acme.fr": { status: "unknown", score: 99 }, "sophie.martin@acme.fr": { status: "unknown", score: 99 } } });
    const none = await findNominativeContact({ domain: "acme.fr", pain: "production des devis", headcount: 60, leader: null, sitePeople: site }, silent.deps);
    check("vérification non concluante : aucune adresse devinée utilisée", none.contact === null, none);

    const noPattern = hunter({ people: [], finder: { email: "marc.lefebvre@acme.fr", score: 91 } });
    const finder = await findNominativeContact({ domain: "acme.fr", pain: "devis", headcount: 60, leader: null, sitePeople: site }, noPattern.deps);
    check("sans schéma : Email Finder sur le nom lu sur le site", finder.contact?.source === "hunter:email-finder" && noPattern.calls.finder === 1, finder.contact);

    check("« À l'attention de M. Pierre Durand »", addresseeHint({ firstName: "Pierre", lastName: "Durand", role: "dirigeant", source: "registre" })?.text === "À l'attention de M. Pierre Durand");
    check("registre à prénoms multiples : le premier seulement", addresseeHint({ firstName: "Daniel Claude Christian Marie", lastName: "Frelet", source: "registre" })?.text === "À l'attention de M. Daniel Frelet");
    check("« À l'attention de Mme Sophie Martin »", addresseeHint({ firstName: "Sophie", lastName: "Martin", source: "site" })?.text === "À l'attention de Mme Sophie Martin");
  }

  console.log("\n6. Rattrapage v2 : générique gardée → addressee_hint ; échecs v1 réessayés");
  {
    const prospect: UpgradeProspect = {
      id: "p9", user_id: "u1", company_name: "PARCOME", email: "contact@parcome.fr", email_type: "generique", website: "https://parcome.fr",
      contact_found_by: "site:contact", do_not_contact: false, deleted_at: null, pain_point: "production des devis", brief: null,
      key_figures: { opposition_checked: true, leader_person: "Pierre DURAND", headcount: 45, nominative: { checked_at: "2026-10-06T10:00:00Z" } },
    };
    const NOW = new Date("2026-10-06T16:00:00Z");
    check("échec de la v1 il y a 6 h : de nouveau éligible (stratégie v2)", ineligibility(prospect, NOW) === null, ineligibility(prospect, NOW));
    check(
      "… mais pas un échec de la même version",
      /90 jours/.test(ineligibility({ ...prospect, key_figures: { ...prospect.key_figures, nominative: { checked_at: "2026-10-06T10:00:00Z", version: NOMINATIVE_VERSION } } }, NOW) ?? ""),
    );

    const fake = new FakeDb({ prospects: [{ ...prospect }], messages: [], prospect_events: [] } as Record<string, Record<string, unknown>[]>);
    const nothing = hunter({ people: [], pattern: null, finder: null });
    const result = await upgradeToNominative(
      fake as unknown as Db,
      prospect,
      { ...nothing.deps, sitePeople: async () => [{ firstName: "Marc", lastName: "Lefebvre", role: "Directeur commercial", url: "x" }] },
      { now: NOW },
    );
    const figures = fake.rows("prospects")[0].key_figures as Record<string, { text?: string; version?: number }>;
    check(
      "rien de vérifié : générique gardée, « À l'attention de M. Marc Lefebvre » (rôle du sujet)",
      result.status === "kept" && figures.addressee_hint?.text === "À l'attention de M. Marc Lefebvre" && fake.rows("prospects")[0].email === "contact@parcome.fr",
      figures.addressee_hint,
    );
    check("… trace datée avec la version", figures.nominative?.version === NOMINATIVE_VERSION);
  }

  console.log("\n7. À qualité égale, le nominatif d'abord (Nouveaux et quota)");
  {
    const item = (key: string, kind: "nominatif" | "generique", quality: number, score: number): RawTodayItem =>
      ({ key, kind: "nouveau", prospectId: key, status: "valide", messageId: `m-${key}`, tags: [], score, quality, contact: { email: `${key}@x.fr`, kind, name: null, phone: null }, exclusion: null }) as unknown as RawTodayItem;
    const raw = [item("gen-ready", "generique", 9.5, 5), item("nom-ready", "nominatif", 9.2, 3), item("nom-weak", "nominatif", 7, 5)];
    const order = groupToday(raw).flatMap((group) => group.items.map((entry) => entry.key));
    check("prêts (≥ 9) : nominatif avant générique, même à score plus bas", order.indexOf("nom-ready") < order.indexOf("gen-ready"), order);
    check("un nominatif non prêt ne passe pas devant un mail prêt", order.indexOf("gen-ready") < order.indexOf("nom-weak"), order);
    const plan = planSchedule({
      items: [item("gen-ready", "generique", 9.5, 5), item("nom-ready", "nominatif", 9.2, 3)] as never,
      remaining: 1,
      now: new Date("2026-10-07T07:30:00Z"),
      random: () => 0,
    });
    check("quota d'une place : c'est la fiche nominative qui part", plan.planned[0]?.key === "nom-ready" && plan.postponed[0]?.key === "gen-ready", plan);
  }

  console.log("\n8. Prénoms multiples du registre");
  {
    check("« Jean-Pierre » reste entier, « Daniel Claude » → « Daniel »", firstGiven("Jean-Pierre") === "Jean-Pierre" && firstGiven("Daniel Claude Christian Marie") === "Daniel");
    const fake = new FakeDb({ prospects: [], messages: [], prospect_events: [] } as Record<string, Record<string, unknown>[]>);
    const spy = hunter({ people: [], pattern: "{first}.{last}" });
    const asked: string[] = [];
    const deps = { ...spy.deps, verify: async (email: string) => { asked.push(email); return { status: "valid" as const, score: 95 }; } };
    const multi: UpgradeProspect = {
      id: "p10", user_id: "u1", company_name: "INSTAN CARE", email: "accueil@instan.fr", email_type: "generique", website: null,
      contact_found_by: "site:contact", do_not_contact: false, deleted_at: null, pain_point: "factures", brief: null,
      key_figures: { opposition_checked: true, leader_person: "Daniel Claude Christian Marie FRELET", headcount: 8 },
    };
    fake.rows("prospects").push({ ...multi });
    await upgradeToNominative(fake as unknown as Db, multi, deps, { now: new Date("2026-10-06T17:00:00Z") });
    check("schéma construit avec le premier prénom : daniel.frelet@instan.fr", asked[0] === "daniel.frelet@instan.fr", asked);
    const mixed: UpgradeProspect = { ...multi, id: "p11", key_figures: { ...multi.key_figures, leader_person: "Claude Pierre Jose Binovic" } };
    const askedMixed: string[] = [];
    fake.rows("prospects").push({ ...mixed });
    await upgradeToNominative(fake as unknown as Db, mixed, { ...spy.deps, verify: async (email: string) => { askedMixed.push(email); return { status: "valid" as const, score: 95 }; } }, { now: new Date("2026-10-06T17:00:00Z") });
    check("casse mixte (« Claude Pierre Jose Binovic ») : nom = dernier mot → claude.binovic@", askedMixed[0] === "claude.binovic@instan.fr", askedMixed);
  }

  console.log("\n9. Boîtes de rôle juridique et initiale + nom (Cowork #41)");
  {
    const roles = ["rgpd-lgs@gerbesavoyarde.com", "rgpd@x.fr", "dpo@x.fr", "privacy@x.com", "donneespersonnelles@x.fr", "donnees-personnelles@x.fr", "cnil@x.fr", "juridique@x.fr", "legal@x.fr", "service.legal@x.fr", "unsubscribe@x.com", "noreply@x.fr", "no-reply@x.fr", "no_reply2@x.fr"];
    check("boîtes de rôle juridique reconnues (préfixe ou morceau)", roles.every(isRoleBox), roles.filter((email) => !isRoleBox(email)));
    const people = ["e.lahmadi@lormedo.fr", "jean.dupont@x.fr", "contact@x.fr", "legallais.pierre@x.fr", "nolwenn.reply@x.fr"];
    check("adresses ordinaires non touchées (y compris « legallais », « nolwenn »)", people.every((email) => !isRoleBox(email)), people.filter(isRoleBox));
    check("LORMEDO : « e.lahmadi » (initiale + nom) est nominative", classifyEmail("e.lahmadi@lormedo.fr") === "nominatif");
    check("… sans faire d'un générique un nominatif", classifyEmail("contact@lormedo.fr") === "generique" && classifyEmail("a.b@x.fr") === "generique");
    check("site : une boîte rgpd@ n'est jamais extraite", !extractEmails("Contact : contact@x.fr — RGPD : rgpd@x.fr, dpo@x.fr").some(isRoleBox) && extractEmails("contact@x.fr rgpd@x.fr").includes("contact@x.fr"));
    const web = hunter({ people: [person("rgpd.service@acme.fr", "Data Protection Officer", 99), person("jeanne.martin@acme.fr", "DAF", 94)] });
    const picked = await findNominativeContact({ domain: "acme.fr", pain: "factures", headcount: 60, leader: null }, web.deps);
    check("recherche nominative : une boîte de rôle n'est jamais retenue", picked.contact?.email === "jeanne.martin@acme.fr", picked.contact);
    const refused = await checkSendRules({} as Db, { id: "m", status: "draft", type: "intro" } as never, "rgpd-lgs@gerbesavoyarde.com", new Date());
    check("règles d'envoi : refus d'une boîte de rôle juridique", Boolean(refused && !refused.ok && /rôle juridique/.test(refused.error)), refused);
  }

  console.log(failures === 0 ? "\nTous les tests des contacts nominatifs passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
