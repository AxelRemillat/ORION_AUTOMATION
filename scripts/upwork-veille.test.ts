/**
 * VEILLE UPWORK PAR E-MAIL (Cowork #68) : les trois familles d'e-mails Upwork.
 *
 *   a) alertes d'offres (plusieurs offres par e-mail) → une opportunité par offre, score Codeur + critères Upwork,
 *      alerte « Upwork 8/10 – <titre> » à 7 ou plus ;
 *   b) message, invitation, offre de contrat → événement prioritaire `upwork_message`, alerte URGENTE ;
 *   c) newsletters, Connects, astuces → ignorés, sans alerte.
 *
 * Toutes les fixtures sont INVENTÉES d'après la structure des e-mails Upwork : aucun vrai e-mail, aucun vrai client.
 */
import { asciiTitle, type Notification } from "../lib/notify/ntfy";
import { ingestPlatformEmail, planPlatformEmail } from "../lib/opportunities/email/ingest-email";
import { parsePlatformEmail, type InboundEmail } from "../lib/opportunities/email/parse";
import { senderOf, upworkJobScore, upworkSignals } from "../lib/opportunities/email/upwork-events";
import type { AskFn } from "../lib/ai/chat";
import { FakeDb } from "./fake-supabase";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const FOOTER = "\n\nYou are receiving this email because of your notification settings.\nManage email notifications: https://www.upwork.com/nx/notification-settings\nUpwork Global Inc., 655 Montgomery Street, San Francisco, CA";

const mail = (id: string, from: string, subject: string, text: string, html = ""): InboundEmail => ({ message_id: `<${id}@upwork.test>`, from, subject, text: text + FOOTER, html, received_at: "2026-10-15T08:00:00Z" });

// a) Alerte d'une recherche enregistrée : trois offres, format texte (titre, lien, budget, extrait).
const JOB_ALERT = mail(
  "alert-0001",
  "Upwork <donotreply@upwork.com>",
  "New job: n8n workflow to route Shopify orders to Google Sheets",
  [
    "New jobs matching your saved search \"n8n automation\":",
    "",
    "n8n workflow to route Shopify orders to Google Sheets",
    "https://www.upwork.com/jobs/~01aa11bb22cc33dd44?source=alert",
    "Fixed-price: $350",
    "We need an n8n workflow that sends every new Shopify order to Google Sheets and alerts us in Slack.",
    "Proposals: Less than 5 · Payment verified",
    "",
    "Création d'un agent IA pour nos devis de menuiserie",
    "https://www.upwork.com/jobs/~01bb22cc33dd44ee55",
    "Hourly: $30.00-$45.00",
    "Agent IA qui lit les demandes de devis reçues par e-mail et prépare un brouillon chiffré.",
    "Proposals: 5 to 10",
    "",
    "Senior RAG chatbot engineer for our legal knowledge base",
    "https://www.upwork.com/jobs/~01cc33dd44ee55ff66",
    "Fixed-price: $1,200",
    "Top Rated only, 5+ years of experience with LangChain required. Build a RAG chatbot over 10,000 contracts.",
    "Proposals: 50+ · Payment unverified",
    "",
    "View job: https://www.upwork.com/jobs/~01aa11bb22cc33dd44",
  ].join("\n"),
);

// Même offre reçue dans une seconde alerte : dédoublonnée par son lien.
const JOB_ALERT_AGAIN = mail(
  "alert-0002",
  "Upwork <donotreply@upwork.com>",
  "Job alert: 1 new job for \"n8n\"",
  ["n8n workflow to route Shopify orders to Google Sheets", "https://www.upwork.com/jobs/~01aa11bb22cc33dd44", "Fixed-price: $350", "Shopify orders to Google Sheets with a Slack alert."].join("\n"),
);

// b) Événements prioritaires.
const CLIENT_MESSAGE = mail(
  "msg-0001",
  "Sarah M. via Upwork <messages@upwork.com>",
  "New message from Sarah M.",
  "Sarah M. sent you a message:\n\n\"Hi Axel, could you have a quick look at our invoice workflow?\"\n\nReply: https://www.upwork.com/ab/messages/rooms/room_1a2b3c4d5e",
);
const INVITATION = mail(
  "inv-0001",
  "Upwork <donotreply@upwork.com>",
  "You have been invited to interview for \"RAG chatbot for our help center\"",
  "Hi Axel,\n\nDaniel R. has invited you to interview for the following job:\n\nRAG chatbot for our help center\nhttps://www.upwork.com/jobs/~01dd44ee55ff66aa77?source=invite\n\nRespond to invitation: https://www.upwork.com/nx/proposals/invitations/1987654321",
);
const CONTRACT_OFFER = mail(
  "offer-0001",
  "Upwork <donotreply@upwork.com>",
  "Daniel R. sent you an offer: \"RAG chatbot for our help center\"",
  "You received an offer.\n\nContract: RAG chatbot for our help center\nFixed-price: $600\n\nReview offer: https://www.upwork.com/ab/offers/offer/55512345",
);

// c) Le reste : ignoré, sans alerte.
const CONNECTS = mail("connects-0001", "Upwork <donotreply@upwork.com>", "Your Connects balance is running low", "You have 4 Connects left. Buy more Connects: https://www.upwork.com/nx/plans/connects");
const TIPS = mail("tips-0001", "Upwork <newsletter@upwork.com>", "5 tips to win your first clients", "Complete your profile, add a portfolio, write short proposals… https://www.upwork.com/resources/tips");

async function main() {
  console.log("\n1. Lecture des e-mails Upwork");
  {
    const parsed = parsePlatformEmail(JOB_ALERT);
    check("alerte de recherche enregistrée (« New job: … ») → recommandation", parsed.kind === "recommandation", parsed.kind);
    check("trois offres, dédoublonnées par lien (le « View job » ne compte pas)", parsed.jobs.length === 3, JSON.stringify(parsed.jobs.map((job) => job.title)));
    check("titre, lien, budget fixe et extrait de la 1re offre", parsed.jobs[0]?.title === "n8n workflow to route Shopify orders to Google Sheets" && parsed.jobs[0]?.url === "https://www.upwork.com/jobs/~01aa11bb22cc33dd44" && /\$350/.test(parsed.jobs[0]?.budget ?? "") && /Shopify order/.test(parsed.jobs[0]?.snippet ?? ""), JSON.stringify(parsed.jobs[0]));
    check("budget horaire de la 2e offre", /\$30\.00-\$45\.00/.test(parsed.jobs[1]?.budget ?? ""), String(parsed.jobs[1]?.budget));
    check("« Job alert: … » → recommandation", parsePlatformEmail(JOB_ALERT_AGAIN).kind === "recommandation");
    check("propositions et paiement lus dans l'e-mail", JSON.stringify(upworkSignals(parsed.jobs[0]!.snippet)) === JSON.stringify({ proposals: "Less than 5", paymentVerified: true }), JSON.stringify(upworkSignals(parsed.jobs[0]!.snippet)));
    check("rien dans l'e-mail → rien d'inventé", JSON.stringify(upworkSignals("Build an n8n workflow.")) === JSON.stringify({ proposals: null, paymentVerified: null }));
    check("expéditeur tel qu'affiché", senderOf(CLIENT_MESSAGE.from) === "Sarah M. via Upwork");
    check("message, invitation, offre de contrat reconnus", parsePlatformEmail(CLIENT_MESSAGE).kind === "message" && parsePlatformEmail(INVITATION).kind === "invitation" && parsePlatformEmail(CONTRACT_OFFER).kind === "offre");
  }

  console.log("\n2. Score Upwork (moteur Codeur + critères Upwork)");
  {
    const job = (title: string, snippet: string, budget: string | null) => ({ title, snippet, budget });
    check("base 8, peu de concurrence → 9", upworkJobScore(8, job("n8n workflow", "Proposals: Less than 5", "$350")).score === 9);
    check("budget fixe sous 100 $ → 4 au plus", upworkJobScore(9, job("n8n workflow", "", "Fixed-price: $60")).score === 4);
    check("taux sous 20 $/h → 4 au plus", upworkJobScore(9, job("AI agent", "", "Hourly: $10.00-$15.00")).score === 4);
    check("hors portfolio (logo) → -2", upworkJobScore(8, job("Logo design for a bakery", "Modern logo and business cards", "$300")).score === 6);
    check("expérience exigée (Top Rated, 5+ ans) → -2", upworkJobScore(8, job("RAG chatbot", "Top Rated only, 5+ years of experience", "$1,200")).score === 6);
    check("50+ propositions et paiement non vérifié → -2", upworkJobScore(8, job("n8n workflow", "Proposals: 50+ · Payment unverified", "$500")).score === 6);
    check("analyse indisponible → aucun score inventé", upworkJobScore(null, job("n8n", "", "$500")).score === null);
  }

  console.log("\n3. Ingestion : opportunités, événements, ignorés, alertes ntfy");
  {
    const db = new FakeDb({ opportunities: [], opportunity_emails: [] });
    const alerts: Notification[] = [];
    const ask: AskFn = async (_role, system) => {
      if (/Tu analyses une annonce/.test(system)) return JSON.stringify({ score: 8, reasons: ["automatisation", "outils connus", "besoin clair"], need: "Automatiser", demo: "general", language: "en", kind: "automatisation" });
      return "";
    };
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-15T08:05:00Z"), notify: async (notification: Notification) => (alerts.push(notification), true) };

    const alert = await ingestPlatformEmail(deps, JOB_ALERT);
    const rows = db.rows("opportunities") as Record<string, unknown>[];
    check("a) une opportunité par offre, plateforme upwork", alert.status === "cree" && alert.opportunity_ids.length === 3 && rows.length === 3 && rows.every((row) => row.platform === "upwork" && row.source === "email"), JSON.stringify(alert));
    check("a) lien de l'offre gardé sur la fiche", rows.some((row) => row.url === "https://www.upwork.com/jobs/~01aa11bb22cc33dd44"));
    const jobAlerts = alerts.filter((item) => item.title.startsWith("Upwork "));
    check("a) alertes seulement à 7 ou plus (2 sur 3 : l'offre « Top Rated, 50+ » reste muette)", jobAlerts.length === 2, alerts.map((item) => item.title).join(" | "));
    check("a) titre « Upwork 9/10 – <titre> », priorité haute, clic vers l'offre", alerts[0]?.title === "Upwork 9/10 – n8n workflow to route Shopify orders to Google Sheets" && alerts[0]?.priority === "high" && alerts[0]?.click === "https://www.upwork.com/jobs/~01aa11bb22cc33dd44", JSON.stringify(alerts[0]));
    check("a) accents lisibles dans le titre ntfy (même normalisation que Codeur)", asciiTitle(alerts[1]?.title ?? "") === "Upwork 8/10 - Creation d'un agent IA pour nos devis de menuiserie", asciiTitle(alerts[1]?.title ?? ""));
    const muted = rows.find((row) => row.external_id === "~01cc33dd44ee55ff66");
    check("a) score ajusté et motifs sur la fiche muette", muted?.fit_score === 4 && (muted.fit_reasons as string[]).some((reason) => /expérience/.test(reason)), JSON.stringify(muted?.fit_reasons));

    const before = alerts.length;
    const again = await ingestPlatformEmail(deps, JOB_ALERT_AGAIN);
    check("a) même offre dans une 2e alerte → dédoublonnée par lien, aucune nouvelle alerte", db.rows("opportunities").length === 3 && alerts.length === before && again.opportunity_ids[0] === alert.opportunity_ids[0], JSON.stringify(again));
    const replay = await ingestPlatformEmail(deps, JOB_ALERT);
    check("a) même e-mail rejoué → doublon", replay.duplicate === true && alerts.length === before);

    const message = await ingestPlatformEmail(deps, CLIENT_MESSAGE);
    const messageAlert = alerts.at(-1)!;
    check("b) message client → événement upwork_message, AUCUNE fiche créée", message.kind === "upwork_message" && message.opportunity_ids.length === 0 && db.rows("opportunities").length === 3, JSON.stringify(message));
    check("b) alerte URGENTE « Upwork – nouveau message », expéditeur et sujet, clic vers la conversation", messageAlert.title === "Upwork – nouveau message" && messageAlert.priority === "urgent" && messageAlert.body === "Sarah M. via Upwork : New message from Sarah M." && messageAlert.click === "https://www.upwork.com/ab/messages/rooms/room_1a2b3c4d5e", JSON.stringify(messageAlert));
    const invitation = await ingestPlatformEmail(deps, INVITATION);
    check("b) invitation → « Upwork – invitation », urgente, clic vers l'invitation", invitation.kind === "upwork_message" && alerts.at(-1)?.title === "Upwork – invitation" && alerts.at(-1)?.priority === "urgent" && alerts.at(-1)?.click === "https://www.upwork.com/nx/proposals/invitations/1987654321", JSON.stringify(alerts.at(-1)));
    const offer = await ingestPlatformEmail(deps, CONTRACT_OFFER);
    check("b) offre de contrat → « Upwork – offre de contrat », clic vers l'offre", offer.kind === "upwork_message" && alerts.at(-1)?.title === "Upwork – offre de contrat" && alerts.at(-1)?.click === "https://www.upwork.com/ab/offers/offer/55512345", JSON.stringify(alerts.at(-1)));
    check("b) accents et tiret lisibles dans le titre ntfy", asciiTitle("Upwork – nouveau message") === "Upwork - nouveau message");
    const events = (db.rows("opportunity_emails") as Record<string, unknown>[]).filter((row) => row.kind === "upwork_message");
    check("b) trois événements tracés « Message Upwork », à trier, avec l'expéditeur et le lien", events.length === 3 && events.every((row) => row.status === "a_trier" && row.alerted === true) && /Sarah M\. via Upwork/.test(String(events[0]?.excerpt)), JSON.stringify(events.map((row) => row.status)));

    const alertsBefore = alerts.length;
    await ingestPlatformEmail(deps, CONNECTS);
    await ingestPlatformEmail(deps, TIPS);
    const ignored = (db.rows("opportunity_emails") as Record<string, unknown>[]).filter((row) => row.message_id === CONNECTS.message_id || row.message_id === TIPS.message_id);
    check("c) Connects et astuces → ignorés, sans alerte, sans fiche", alerts.length === alertsBefore && ignored.length === 2 && ignored.every((row) => row.status === "ignore") && db.rows("opportunities").length === 3, JSON.stringify(ignored.map((row) => row.status)));

    const plan = await planPlatformEmail(deps, { ...CLIENT_MESSAGE, message_id: "<msg-dry@upwork.test>" });
    check("mode test : un message serait un événement avec alerte", plan.action === "evenement" && plan.would_alert === true && plan.kind === "upwork_message", JSON.stringify(plan));
  }

  console.log(failures === 0 ? "\nTous les tests de la veille Upwork passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
