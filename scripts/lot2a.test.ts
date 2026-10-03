/**
 * Lot 2a (02/10/2026) — qualité des brouillons et préparation quotidienne.
 * Fixtures seulement : aucun crédit Hunter / Pappers / OpenAI, aucun envoi.
 * Exécution : `npm run test:lot2a`.
 */
import { readFileSync } from "node:fs";
import { buildFacts } from "../lib/emails/derived-facts";
import { freshJobHook } from "../lib/emails/incoming-leader";
import { interpretJob } from "../lib/emails/job-roles";
import { CLIENT_ACCOUNTING_PAIN, isClientAccounting, painForJob } from "../lib/funnel/pain-map";
import { requireProfileWhenSiteKnown } from "../lib/jobs/handlers/email";
import { chooseProof } from "../lib/offer/model";
import { defaultOffer } from "../lib/offer/read";
import { draftIfReady } from "../lib/today/auto-draft";
import { autoRunDue } from "../lib/today/auto-run";
import { isComplete, needsIntroDraft, tagsOf } from "../lib/today/tags";
import type { Db } from "../lib/trash/scope";
import type { Prospect } from "../types";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const NOW = new Date("2026-10-05T07:30:00Z"); // lundi 9 h 30 à Paris
/** Profil métier valide (PROFILE_SCHEMA). */
const PROFILE = {
  offer: "Prestations informatiques et insertion professionnelle de personnes handicapées",
  customers: "B2B",
  demandChannels: ["formulaire de contact"],
  counts: [],
  services: [],
};
const USER = "u1";

// --- NEW NET 3D (511178287) : données réelles de la base, 02/10/2026 -------------
const NEW_NET_TITLE = "Comptable clients (H/F)";
const NEW_NET_OFFER =
  "NEW NET 3D recrute un Comptable clients (H/F) : émission des factures clients liées aux prestations informatiques, suivi des encaissements et relances des paiements en retard.";
const newNet = (over: Partial<Prospect> = {}): Prospect =>
  ({
    id: "newnet", user_id: USER, company_name: "NEW NET 3D (GROUPE TALENTS HANDICAP)", siren: "511178287",
    website: "https://talents-handicap.com", email: "contact@talents-handicap.com", sector: "Programmation informatique",
    size_range: "10 à 19 salariés", city: "Cagnes-sur-Mer", source: "auto", status: "nouveau", created_at: "", updated_at: "",
    pain_point: null, deleted_at: null, do_not_contact: false, business_profile: null,
    key_figures: { leader: "REDWANE BENNANI", headcount: 10, funnel_score: 4, leader_person: "Redwane Bennani", job_title: NEW_NET_TITLE, pappers_read: true },
    signals: [
      {
        type: "recrutement",
        label: `Poste ouvert : ${NEW_NET_TITLE} — France Travail`,
        url: "https://candidat.francetravail.fr/offres/recherche/detail/X",
        source: "France Travail",
        quote: NEW_NET_OFFER,
        confidence: 0.9,
        date: "2026-09-29",
        // Comme un signal de l'entonnoir (lib/funnel/dig.ts, toProspectSignal) : source officielle datée.
        dateBasis: "source",
      },
    ],
    ...over,
  }) as unknown as Prospect;

async function main() {
  // -------------------------------------------------------------------------
  console.log("\n1. « Comptable clients » : facturation et relances, pas factures fournisseurs");
  {
    check("NEW NET 3D : intitulé « Comptable clients » → facturation clients et relances", painForJob(NEW_NET_TITLE, NEW_NET_OFFER) === CLIENT_ACCOUNTING_PAIN, painForJob(NEW_NET_TITLE, NEW_NET_OFFER));
    check("intitulé seul suffit (sans l'offre)", painForJob(NEW_NET_TITLE) === CLIENT_ACCOUNTING_PAIN);
    check("comptable générique + offre qui parle encaissement et relances → clients", painForJob("Comptable H/F", "Vous assurez la facturation, l'encaissement et les relances clients.") === CLIENT_ACCOUNTING_PAIN);
    check("comptable générique + profil métier qui parle facturation → clients", isClientAccounting("Aide-comptable", JSON.stringify({ activites: ["facturation des prestations", "relances"] })));
    check("comptable fournisseurs : reste côté fournisseurs", painForJob("Comptable fournisseurs", "Saisie des factures fournisseurs et relances fournisseurs.") === "factures fournisseurs et rapprochement bancaire");
    check("comptable générique sans indice : inchangé (fournisseurs)", painForJob("Comptable H/F", "Tenue de la comptabilité générale.") === "factures fournisseurs et rapprochement bancaire");
    check("« relances fournisseurs » ne fait pas basculer côté clients", !isClientAccounting("Comptable", "Saisie et relances fournisseurs."));
    check("credit manager / recouvrement → clients", painForJob("Credit manager") === CLIENT_ACCOUNTING_PAIN && painForJob("Chargé de recouvrement") === CLIENT_ACCOUNTING_PAIN);
    check("les autres postes ne bougent pas (ADV)", painForJob("Assistant ADV") === "saisie des commandes et des devis");

    const role = interpretJob(NEW_NET_OFFER);
    check("rédaction : poste lu « Comptable clients »", role?.key === "comptable_clients" && role.consequence.includes("relancer"), role);
    check("rédaction : comptable générique + offre clients → rôle clients", interpretJob("recrute un comptable", "facturation clients et relances")?.key === "comptable_clients");
    const hook = freshJobHook({ jobTitle: NEW_NET_TITLE, date: "2026-09-29" }, NOW, NEW_NET_OFFER);
    check("rédaction : tâche de l'offre = facturation clients et relances", hook?.task === "la facturation clients et les relances de paiement", hook);

    const facts = buildFacts(newNet(), null, NOW).facts;
    const hints = facts.map((fact) => `${fact.writerHint ?? ""} ${fact.reading ?? ""}`).join(" ");
    check("faits du stratège : facturation clients et relances", /facturation clients/.test(hints) && /relance/.test(hints), hints.slice(0, 300));
    check("… plus jamais « factures fournisseurs » ni « reporting »", !/fournisseurs/.test(hints) && !/reporting/i.test(hints));

    const proof = chooseProof(defaultOffer(), CLIENT_ACCOUNTING_PAIN);
    check("preuve : la démo factures, pas « les comptes rendus »", proof.demo?.key === "factures", proof);
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Jamais de brouillon avec un profil vide quand la fiche a un site");
  {
    const base = { email: "a@b.fr", emailDoubtful: false, oppositionUnverified: false, website: "https://x.fr", hasBusinessProfile: false, hasDraft: false, draftPending: false };
    const tags = tagsOf(base);
    check("site connu, profil vide : « Profil à compléter » (bloquant)", tags.includes("Profil à compléter") && !isComplete(tags, true), tags);
    const item = { messageType: "intro", status: "todo", messageId: null, draftPending: false, contact: { email: "a@b.fr" }, tags };
    check("brouillon automatique permis : la génération LIT le site d'abord", needsIntroDraft(item));
    check("lecture déjà échouée : plus de brouillon automatique", !needsIntroDraft({ ...item, profileReadFailed: true }));

    // Le job : site connu, aucun profil après lecture → refus, échec daté, aucun brouillon.
    const db = new FakeDb({ prospects: [newNet()], messages: [] });
    let error = "";
    await requireProfileWhenSiteKnown({ db: db as unknown as Db, userId: USER }, newNet(), [{ source: "openai", message: "Site talents-handicap.com écarté" }], NOW).catch((cause: Error) => {
      error = cause.message;
    });
    const figures = db.rows("prospects")[0].key_figures as Record<string, unknown>;
    check("job : refuse de rédiger (« Profil à compléter »)", error.startsWith("Profil à compléter") && error.includes("talents-handicap.com"), error);
    check("… échec daté sur la fiche", figures.profile_failed_at === NOW.toISOString());
    check("… aucun brouillon écrit", db.rows("messages").length === 0);

    let passed = true;
    await requireProfileWhenSiteKnown({ db: db as unknown as Db, userId: USER }, newNet({ business_profile: PROFILE as never, key_figures: { profile_failed_at: "x" } as never })).catch(() => {
      passed = false;
    });
    check("profil lu : la rédaction continue, l'échec passé est effacé", passed && !("profile_failed_at" in (db.rows("prospects")[0].key_figures as Record<string, unknown>)));
    let noSite = true;
    await requireProfileWhenSiteKnown({ db: db as unknown as Db, userId: USER }, newNet({ website: null })).catch(() => {
      noSite = false;
    });
    check("sans site : la règle ne s'applique pas", noSite);
  }

  // -------------------------------------------------------------------------
  console.log("\n3. Fiche complétée → brouillon lancé automatiquement");
  {
    // NEW NET 3D publie ses offres pour des clients (« signal pour un client »,
    // 03/10/2026) : elle est désormais hors cible. Le mécanisme testé ici ne
    // dépend pas de l'entreprise : même fiche, nom et site neutres.
    const tables = (over: Record<string, unknown> = {}) => ({
      prospects: [{ ...newNet(), company_name: "ACME LOGISTIQUE", website: "https://acme-logistique.fr", business_profile: PROFILE, ...over }],
      messages: [], signal_candidates: [], reminders: [], inbound_messages: [], prospect_discards: [], jobs: [],
    });
    const queued: { prospectId?: string; mode?: string }[] = [];
    const enqueue = (async (_db: unknown, input: { params: { prospectId?: string; mode?: string } }) => {
      queued.push(input.params);
      return { id: "job-1" };
    }) as never;
    // Une intro en attente : la fiche entre dans la file par son brouillon… absent → via un candidat.
    const withCandidate = (over: Record<string, unknown> = {}) => ({
      ...tables(over),
      signal_candidates: [{ id: "c", user_id: USER, statut: "creusé", publication: "pret", prospect_id: "newnet", source: "france-travail", facts: { label: "Recrutement", jobTitle: NEW_NET_TITLE }, identity: null, triage: { score: 4 }, contact: over.email === null ? { badge: "aucun" } : { badge: "generique", email: "contact@talents-handicap.com" }, badges: [], score: 4, weight: 1, date_signal: "2026-09-29", url_source: null, siren: null, company_name: "NEW NET 3D", motif_rejet: null }],
    });

    check("plus aucun manque sauf le brouillon : lancé sans clic", (await draftIfReady(new FakeDb(withCandidate()) as unknown as Db, USER, "newnet", { now: NOW, enqueue })) === "lancé" && queued.at(-1)?.mode === "full", queued);
    check("email manquant : rien n'est lancé", (await draftIfReady(new FakeDb(withCandidate({ email: null })) as unknown as Db, USER, "newnet", { now: NOW, enqueue: (async () => { throw new Error("ne doit pas être appelé"); }) as never })) === "pas prête");
    check("opposition non vérifiée : rien n'est lancé", (await draftIfReady(new FakeDb(withCandidate({ key_figures: { job_title: NEW_NET_TITLE } })) as unknown as Db, USER, "newnet", { now: NOW, enqueue })) === "pas prête");
    check("site illisible déjà constaté : rien n'est lancé", (await draftIfReady(new FakeDb(withCandidate({ business_profile: null, key_figures: { pappers_read: true, profile_failed_at: "2026-10-02T16:30:00Z" } })) as unknown as Db, USER, "newnet", { now: NOW, enqueue })) === "pas prête");
    const pending = withCandidate();
    pending.jobs = [{ user_id: USER, type: "email_generate", status: "running", target: { prospectId: "newnet" } }] as never;
    check("brouillon déjà en préparation : pas de doublon", (await draftIfReady(new FakeDb(pending) as unknown as Db, USER, "newnet", { now: NOW, enqueue })) === "déjà en cours");

    const realNewNet = { ...withCandidate(), prospects: [{ ...newNet(), business_profile: PROFILE }] };
    check("NEW NET 3D elle-même : hors cible, aucun brouillon lancé", (await draftIfReady(new FakeDb(realNewNet) as unknown as Db, USER, "newnet", { now: NOW, enqueue })) === "pas prête");
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Préparation de 5 h : lundi–vendredi seulement");
  {
    const at = (iso: string) => autoRunDue({ daily: true, autoHour: 5, lastRunOn: null, now: new Date(iso) });
    check("lundi 5 h (Paris) : due", at("2026-10-05T03:00:00Z"));
    check("vendredi 5 h : due", at("2026-10-09T03:00:00Z"));
    check("samedi 5 h : pas de préparation auto", !at("2026-10-03T03:00:00Z"));
    check("dimanche 5 h : pas de préparation auto", !at("2026-10-04T03:00:00Z"));
    check("dimanche 23 h 30 UTC = lundi 1 h 30 Paris, avant 5 h : pas encore", !at("2026-10-04T23:30:00Z"));
  }

  // -------------------------------------------------------------------------
  console.log("\n5. .gitignore : fichiers du relais");
  {
    const lines = readFileSync(".gitignore", "utf8").split(/\r?\n/).map((line) => line.trim());
    const wanted = [".claude/relay.on", ".claude/relay.log", ".claude/relay-state.json", ".claude/settings.local.json"];
    check("relay.on, relay.log, relay-state.json, settings.local.json ignorés", wanted.every((entry) => lines.includes(entry)), wanted.filter((entry) => !lines.includes(entry)));
  }

  console.log(failures === 0 ? "\nTous les tests du lot 2a passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
