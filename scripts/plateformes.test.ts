/**
 * Plateformes freelance (plateformes #1) : règles Upwork, check-list anglaise,
 * parseurs d'e-mails Malt / ComeUp / Upwork, ingestion par e-mail (création,
 * suivi, dédoublonnage, alertes), Cockpit 7 / 30 jours. Fixtures uniquement,
 * aucun appel réel.
 */
import { assembleProposal, checkProposal, generateProposal } from "../lib/opportunities/proposal";
import { buildProposalChecklistPrompt, judgeProposalChecklist, proposalCodeChecks } from "../lib/opportunities/proposal-checklist";
import { PROPOSAL_POSITIVES } from "../lib/opportunities/calibration";
import { firstSentence, upworkFailures, usdAmounts, usdRange, PLATFORM_RULES } from "../lib/opportunities/platforms";
import { UPWORK_CHECKLIST } from "../lib/opportunities/checklist-en";
import { parseInboundEmail, parsePlatformEmail, platformOfSender, htmlToText } from "../lib/opportunities/email/parse";
import { ingestPlatformEmail, statusAfterEvent } from "../lib/opportunities/email/ingest-email";
import { suggestedPrice } from "../lib/opportunities/email/view";
import { platformActivity } from "../lib/opportunities/stats";
import { buildOpportunityPatch, parseNewOpportunity, titleFromBody } from "../lib/opportunities/input";
import { requestedItems } from "../lib/opportunities/requests";
import { STATUS_LABELS } from "../lib/opportunities/types";
import type { AskFn } from "../lib/ai/chat";
import type { Notification } from "../lib/notify/ntfy";
import { FakeDb } from "./fake-supabase";
import { EMAIL_FIXTURES } from "./fixtures/opportunity-emails";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const upworkPositives = PROPOSAL_POSITIVES.filter((item) => item.platform === "upwork");

async function main() {
  console.log("\n1. Règles par plateforme");
  {
    check("Codeur, Malt, ComeUp : FR, aucun contact, 1 000 caractères", (["codeur", "malt", "comeup"] as const).every((platform) => PLATFORM_RULES[platform].noContact && PLATFORM_RULES[platform].language === "fr" && PLATFORM_RULES[platform].maxChars === 1000));
    check("Upwork : EN, accroche, 1 200 caractères, dollars, prix obligatoire", PLATFORM_RULES.upwork.language === "en" && PLATFORM_RULES.upwork.hookFirst && PLATFORM_RULES.upwork.maxChars === 1200 && PLATFORM_RULES.upwork.currency === "USD" && PLATFORM_RULES.upwork.priceRequired);
    check("statut « entretien » affiché « Conversation »", STATUS_LABELS.entretien === "Conversation");
  }

  console.log("\n2. Upwork : accroche, longueur, un prix, un délai");
  {
    for (const item of upworkPositives) {
      const { core, text } = assembleProposal(item, { language: "en", demo: item.demo, platform: "upwork" });
      const rules = checkProposal(item, core, { language: "en", budget: item.budget, platform: "upwork", requested: requestedItems(item.ad), ad: item.ad }, text);
      check(`positif Upwork « ${item.title.slice(0, 40)} » : règles OK (${text.length} car.)`, rules.ok && text.length <= 1200, rules.failures.join(" | "));
      check(`… s'ouvre sur l'accroche, sans « Hello, »`, !/^(hello|hi)\b/i.test(text) && text.startsWith(item.reading.split(" ")[0]));
      check("… signature sans le site", text.endsWith("Axel Remillat · AI & automation for small businesses"));
    }
    const fails = (text: string, framing: string) => upworkFailures(text, framing);
    check("« Hello, » en ouverture refusé", fails("Hello, I can help.\n\nFixed price: $500. Delivery: 7 days.", "Fixed price: $500. Delivery: 7 days.").some((line) => /preview/.test(line)));
    check("« I am an expert… » refusé", fails("I am an expert in n8n. More text.", "Fixed price: $500. Delivery: 7 days.").some((line) => /preview/.test(line)));
    check("accroche trop longue refusée", fails(`${"Your Shopify orders ".repeat(15)}. Rest.`, "Fixed price: $500. Delivery: 7 days.").some((line) => /First sentence/.test(line)));
    check("plus de 1 200 caractères refusé", fails(`Your orders land in Airtable. ${"x".repeat(1250)}`, "Fixed price: $500. Delivery: 7 days.").some((line) => /1200 characters/.test(line)));
    check("fourchette « $500–800 » refusée", fails("Your orders land in Airtable.", "Price: $500–800. Delivery: 7 days.").some((line) => /range/.test(line)));
    check("deux prix différents refusés", fails("Your orders land in Airtable.", "Fixed price: $500, or $650 with tests. Delivery: 7 days.").some((line) => /different prices/.test(line)));
    check("aucun prix refusé (l'enchère Upwork en exige un)", fails("Your orders land in Airtable.", "Delivery: 7 days.").some((line) => /no price/.test(line)));
    check("aucun délai refusé", fails("Your orders land in Airtable.", "Fixed price: $500.").some((line) => /timeline/.test(line)));
    check("taux horaire unique accepté ($40/hr, 2 weeks)", fails("Your orders land in Airtable.", "Rate: $40/hr. Delivery: about 2 weeks.").length === 0, fails("Your orders land in Airtable.", "Rate: $40/hr. Delivery: about 2 weeks.").join(" | "));
    check("montants USD lus (fixe, horaire, k)", JSON.stringify(usdAmounts("Fixed $1,500; rate $40/hr; budget $2k")) === JSON.stringify([{ value: 1500, hourly: false }, { value: 40, hourly: true }, { value: 2000, hourly: false }]), JSON.stringify(usdAmounts("Fixed $1,500; rate $40/hr; budget $2k")));
    check("fourchette USD détectée", usdRange("between $1,000 and $1,500") !== null && usdRange("Fixed price: $900.") === null);
    check("1re phrase extraite", firstSentence("Your 40 PDF manuals can answer. Second.") === "Your 40 PDF manuals can answer.");
    const base = upworkPositives[0];
    const price = (framing: string, extra: Partial<typeof base> = {}) => {
      const parts = { ...base, framing, ...extra };
      const { core, text } = assembleProposal(parts, { language: "en", demo: base.demo, platform: "upwork" });
      return checkProposal(parts, core, { language: "en", budget: base.budget, platform: "upwork" }, text).failures;
    };
    check("$5,000 en automatisation refusé (positionnement)", price("Fixed price: $5,000. Delivery: 14 days.").some((line) => /positioning/.test(line)));
    check("$90/hr refusé (positionnement horaire)", price("Rate: $90/hr. Delivery: 14 days.").some((line) => /\/hr is above/.test(line)));
    check("prix du texte ≠ enchère suggérée refusé", price("Fixed price: $900. Delivery: 14 days.", { amountEur: 1200 }).some((line) => /differs from the bid/.test(line)));
    // Essai réel du 07/10 : « Please include … your timeline » + prix en dollars était refusé (seuls les € comptaient).
    {
      const parts = { ...base, framing: "Delivery: 10 days. Fixed price: $800." };
      const { core, text } = assembleProposal(parts, { language: "en", demo: base.demo, platform: "upwork" });
      const failuresUsd = checkProposal(parts, core, { language: "en", budget: "$800 fixed", platform: "upwork", requested: ["prix", "delai"] }, text).failures;
      check("prix demandé : un prix en dollars y répond (Upwork)", !failuresUsd.some((line) => /« prix »/.test(line)), failuresUsd.join(" | "));
    }
    check("sans budget affiché, un prix reste exigé (pas la règle « Budget absent » du FR)", !price("Fixed price: $900. Delivery: 14 days.", { budget: null }).some((line) => /Budget absent/.test(line)));
  }

  console.log("\n3. Check-list anglaise (8 points) dans le moteur d'agent2 (#32)");
  {
    check("8 points, un par critère P1 à P8", UPWORK_CHECKLIST.items.map((item) => item.id).join(",") === "P1,P2,P3,P4,P5,P6,P7,P8");
    const prompt = buildProposalChecklistPrompt("upwork");
    check("consigne du modèle Upwork : anglais, aperçu de la 1re phrase, même JSON P1/P3/P4/P6", /You are the CLIENT/.test(prompt) && /FIRST sentence/.test(prompt) && /"P1":\{"ok":true\|false/.test(prompt) && !/Tu es le CLIENT/.test(prompt));
    check("consigne Codeur inchangée (français)", /Tu es le CLIENT/.test(buildProposalChecklistPrompt("codeur")));
    const item = upworkPositives[0];
    const { text } = assembleProposal(item, { language: "en", demo: item.demo, platform: "upwork" });
    const ctx = { platform: "upwork" as const, ad: item.ad, budget: item.budget, amountEur: null, delayDays: null };
    const code = proposalCodeChecks(text, ctx);
    check("positif Upwork : P2, P5, P7, P8 à OUI (dollars, accroche, sans « Hello, »)", code.every((criterion) => criterion.ok), code.filter((criterion) => !criterion.ok).map((criterion) => `${criterion.id} ${criterion.citation}`).join(" | "));
    const hello = proposalCodeChecks(`Hello,\n\n${text}`, ctx).find((criterion) => criterion.id === "P7");
    check("« Hello, » en tête : P7 à NON (aperçu gâché)", hello?.ok === false && /weak opening/.test(hello.citation), hello?.citation);
    const euros = proposalCodeChecks(text.replace("$1,500", "1 500 €"), ctx).find((criterion) => criterion.id === "P5");
    check("prix en euros sur Upwork : P5 à NON", euros?.ok === false, euros?.citation);
    const long = proposalCodeChecks(`${text.split("\n\n")[0]}\n\n${"More detail. ".repeat(110)}\n\n${text}`, ctx).find((criterion) => criterion.id === "P7");
    check("plus de 1 200 caractères : P7 à NON", long?.ok === false, long?.citation);
    // Essai réel du 07/10 : « 150 monthly leads » lu comme un délai de 4 500 jours.
    const monthly = proposalCodeChecks(text.replace(item.reading, `Your 150 monthly support questions can be answered from your 40 PDF manuals. ${item.reading}`), { ...ctx, delayDays: 21 }).find((criterion) => criterion.id === "P5");
    check("« 150 monthly » n'est pas un délai (P5 OK)", monthly?.ok === true, monthly?.citation);
    const verdicts = await judgeProposalChecklist(async () => JSON.stringify({ P1: { ok: true, citation: "a" }, P3: { ok: true, citation: "b" }, P4: { ok: true, citation: "c" }, P6: { ok: true, citation: "d" } }), { title: item.title, text, ...ctx });
    check("check-list complète : 8/8, prête", verdicts?.ready === true && verdicts.items.length === 8, JSON.stringify(verdicts?.items.filter((criterion) => !criterion.ok)));
  }

  console.log("\n4. Boucle Upwork : JSON horaire, devise rendue, consigne anglaise");
  {
    const item = upworkPositives[0];
    const systems: string[] = [];
    const ask: AskFn = async (role, system) => {
      systems.push(system);
      if (role === "writer") return JSON.stringify({ reading: item.reading, steps: item.steps, framing: "Rate: $40/hr, about 30 hours. Delivery: 21 days.", question: item.question, amount_eur: 40, delay_days: 21, hourly: true });
      return JSON.stringify({ P1: { ok: true, citation: "a" }, P3: { ok: true, citation: "b" }, P4: { ok: true, citation: "c" }, P6: { ok: true, citation: "d" } });
    };
    const outcome = await generateProposal({ ask, platform: "upwork", language: "en", title: item.title, body: item.ad, budget: item.budget, need: "Support chatbot", demo: item.demo });
    check("proposition Upwork prête, enchère horaire $40/hr", "text" in outcome && !outcome.needsReview && outcome.currency === "USD" && outcome.hourly && outcome.amountEur === 40, JSON.stringify(outcome));
    check("le rédacteur reçoit la consigne d'accroche et de prix en dollars", systems.some((system) => /LA 1re PHRASE EST L'APERÇU/.test(system) && /DOLLARS/.test(system)));
    check("la lecture du modèle reçoit la check-list anglaise", systems.some((system) => /You are the CLIENT who posted this job on Upwork/.test(system)));
    check("montant affiché : $40/hr, $550, 450 €", suggestedPrice(40, "USD", true) === "$40/hr" && suggestedPrice(550, "USD", false) === "$550" && suggestedPrice(450, "EUR", false) === "450 €");
  }

  console.log("\n5. Coller une annonce");
  {
    const pasted = parseNewOpportunity({ platform: "upwork", url: "https://www.upwork.com/jobs/~01abc", budget: "$500 fixed", body: "Automate our invoice intake from Gmail to QuickBooks\nWe receive 200 invoices a month and want them extracted automatically." });
    check("sans titre : la 1re ligne de l'annonce en tient lieu", pasted.ok && pasted.value.title === "Automate our invoice intake from Gmail to QuickBooks", JSON.stringify(pasted));
    check("titre long coupé proprement", titleFromBody(`${"Automate ".repeat(30)}`).endsWith("…") && titleFromBody(`${"Automate ".repeat(30)}`).length <= 121);
    const now = new Date("2026-10-07T12:00:00Z");
    const conversation = buildOpportunityPatch({ status: "entretien" }, { status: "reponse", sent_at: "x", replied_at: "x" }, now);
    check("passage en Conversation daté (conversation_at)", conversation.ok && conversation.patch.conversation_at === now.toISOString());
    const won = buildOpportunityPatch({ status: "gagnee" }, { status: "entretien", sent_at: "x", replied_at: "x", conversation_at: "x" }, now);
    check("Gagnée datée (won_at), conversation_at gardé", won.ok && won.patch.won_at === now.toISOString() && !("conversation_at" in won.patch));
  }

  console.log("\n6. Parseurs d'e-mails (fixtures réalistes, fictives)");
  {
    check("corps sans message_id refusé", !parseInboundEmail({ from: "x", subject: "y", text: "z" }).ok);
    check("e-mail vide refusé", !parseInboundEmail({ message_id: "a" }).ok);
    check("date reçue normalisée en ISO", (parseInboundEmail({ message_id: "a", subject: "s", received_at: "Tue, 07 Oct 2026 08:12:00 +0000" }) as { ok: true; value: { received_at: string } }).value.received_at === "2026-10-07T08:12:00.000Z");
    check("expéditeurs : sous-domaines et domaines nationaux", platformOfSender("Upwork <donotreply@e.upwork.com>") === "upwork" && platformOfSender("noreply@malt.de") === "malt" && platformOfSender("x@5euros.com") === "comeup" && platformOfSender("phish@upwork.com.evil.io") === null);
    check("HTML → texte (styles retirés, entités décodées)", htmlToText("<style>.a{}</style><p>Prix&nbsp;: 120&euro;</p><br>Fin") === "Prix : 120€\n\nFin");
    for (const fixture of EMAIL_FIXTURES) {
      const parsed = parsePlatformEmail(fixture.email);
      const expect = fixture.expect;
      const diffs = [
        parsed.platform !== expect.platform && `platform=${parsed.platform}`,
        parsed.kind !== expect.kind && `kind=${parsed.kind}`,
        expect.title !== undefined && parsed.title !== expect.title && `title=${parsed.title}`,
        expect.externalId !== undefined && parsed.externalId !== expect.externalId && `externalId=${parsed.externalId}`,
        expect.client !== undefined && parsed.clientName !== expect.client && `client=${parsed.clientName}`,
        expect.budget !== undefined && parsed.budget !== expect.budget && `budget=${parsed.budget}`,
        expect.amountEur !== undefined && parsed.amountEur !== expect.amountEur && `amount=${parsed.amountEur}`,
        expect.jobs !== undefined && parsed.jobs.length !== expect.jobs && `jobs=${parsed.jobs.length}`,
      ].filter(Boolean);
      check(`${fixture.name} → ${expect.kind}`, diffs.length === 0, diffs.join(", "));
    }
    const reco = parsePlatformEmail(EMAIL_FIXTURES.find((fixture) => fixture.expect.kind === "recommandation")!.email);
    check("recommandations : titres des ancres, liens de suivi dé-encodés, « View job » ignoré", reco.jobs[0]?.title === "Automate invoice extraction from PDF to QuickBooks" && reco.jobs[0]?.externalId === "~01ff00aa11bb22cc33" && reco.jobs[1]?.externalId === "~01dd44ee55ff66aa77", JSON.stringify(reco.jobs));
    check("pied de page des plateformes retiré du corps", !/Palo Alto|notification settings/i.test(parsePlatformEmail(EMAIL_FIXTURES[0].email).body));
  }

  console.log("\n7. Avancement du statut par événement (jamais en arrière)");
  {
    check("message sur « Envoyée » → Réponse", statusAfterEvent("envoyee", "message") === "reponse");
    check("message sur « Réponse » → Conversation", statusAfterEvent("reponse", "message") === "entretien");
    check("message sur « Conversation » → inchangé", statusAfterEvent("entretien", "message") === null);
    check("offre → Conversation ; mission confirmée → Gagnée", statusAfterEvent("envoyee", "offre") === "entretien" && statusAfterEvent("entretien", "gagnee") === "gagnee");
    check("clôture d'une mission gagnée → inchangée", statusAfterEvent("gagnee", "perdue") === null && statusAfterEvent("envoyee", "perdue") === "perdue");
    check("message sur « Gagnée » → inchangé (jamais en arrière)", statusAfterEvent("gagnee", "message") === null);
  }

  console.log("\n8. Ingestion par e-mail : création, suivi, dédoublonnage, alertes");
  {
    const db = new FakeDb({ opportunities: [], opportunity_emails: [] });
    const alerts: Notification[] = [];
    let llmCalls = 0;
    const ask: AskFn = async (role, system) => {
      llmCalls += 1;
      if (/Tu analyses une annonce/.test(system)) return JSON.stringify({ score: 8, reasons: ["n8n", "Airtable", "volume clair"], need: "Synchroniser les commandes", demo: "general", language: "en", kind: "automatisation" });
      return ""; // rédaction indisponible : la proposition reste à faire, sans casser l'ingestion
    };
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-07T12:00:00Z"), notify: async (notification: Notification) => (alerts.push(notification), true) };
    const byName = (prefix: string) => EMAIL_FIXTURES.find((fixture) => fixture.name.startsWith(prefix))!.email;
    const opp = (id: string) => db.rows("opportunities").find((row) => row.id === id) as Record<string, unknown>;

    const invitation = await ingestPlatformEmail(deps, byName("Upwork — invitation"));
    const invitationRow = opp(invitation.opportunity_ids[0]);
    check("invitation Upwork → opportunité créée, analysée, alerte envoyée", invitation.status === "cree" && invitation.alerted && invitationRow?.fit_score === 8 && invitationRow.source === "email" && invitationRow.external_id === "~01a2b3c4d5e6f7a8b9", JSON.stringify(invitation));
    check("… client et lien de l'annonce gardés", invitationRow.client_name === "Jordan K." && invitationRow.url === "https://www.upwork.com/jobs/~01a2b3c4d5e6f7a8b9");
    check("… alerte « Invitation Upwork : … » vers la fiche", /^Invitation Upwork : Build an n8n/.test(alerts[0]?.title ?? "") && alerts[0]?.click === invitation.orion_url, JSON.stringify(alerts[0]));
    const calls = llmCalls;
    const replay = await ingestPlatformEmail(deps, byName("Upwork — invitation"));
    check("même message_id rejoué → doublon, aucun appel, aucune alerte", replay.duplicate === true && llmCalls === calls && alerts.length === 1 && db.rows("opportunities").length === 1);

    db.rows("opportunities")[0].status = "envoyee";
    db.rows("opportunities")[0].sent_at = "2026-10-07T09:00:00Z";
    const message = await ingestPlatformEmail(deps, byName("Upwork — nouveau message"));
    check("message Upwork → rattaché (même titre), statut Réponse, sans alerte", message.status === "rattache" && message.opportunity_ids[0] === invitation.opportunity_ids[0] && message.opportunity_status === "reponse" && !message.alerted && alerts.length === 1, JSON.stringify(message));
    check("… replied_at posé", typeof invitationRow.replied_at === "string");
    const offer = await ingestPlatformEmail(deps, byName("Upwork — offre"));
    check("offre → Conversation (conversation_at)", offer.opportunity_status === "entretien" && typeof invitationRow.conversation_at === "string");
    const contract = await ingestPlatformEmail(deps, byName("Upwork — contrat"));
    check("contrat démarré → Gagnée (won_at)", contract.opportunity_status === "gagnee" && invitationRow.status === "gagnee" && typeof invitationRow.won_at === "string", JSON.stringify(contract));

    const declined = await ingestPlatformEmail(deps, byName("Upwork — proposition refusée"));
    check("refus sur une annonce inconnue → à trier, rien créé", declined.status === "a_trier" && db.rows("opportunities").length === 1);
    const weekly = await ingestPlatformEmail(deps, byName("Upwork — résumé"));
    check("e-mail Upwork non reconnu → à trier, sans alerte", weekly.status === "a_trier" && !weekly.alerted);
    const news = await ingestPlatformEmail(deps, byName("Expéditeur inconnu"));
    check("expéditeur inconnu → à trier", news.status === "a_trier" && news.platform === null);
    check("les e-mails à trier sont stockés (3)", db.rows("opportunity_emails").filter((row) => row.status === "a_trier").length === 3);

    const reco = await ingestPlatformEmail(deps, byName("Upwork — recommandations"));
    check("recommandations → 2 opportunités « brouillon sur extrait », sans alerte", reco.status === "cree" && reco.opportunity_ids.length === 2 && !reco.alerted && alerts.length === 1 && reco.opportunity_ids.every((id) => opp(id).description_truncated === true));

    const unknownMessage = await ingestPlatformEmail(deps, byName("Upwork — message d'un client"));
    const unknownRow = opp(unknownMessage.opportunity_ids[0]);
    check("message Upwork sans fiche → opportunité « Réponse » (sent_at, replied_at), sans alerte", unknownMessage.status === "cree" && unknownRow.status === "reponse" && typeof unknownRow.sent_at === "string" && typeof unknownRow.replied_at === "string" && !unknownMessage.alerted, JSON.stringify(unknownRow));

    const malt = await ingestPlatformEmail(deps, byName("Malt — nouvelle demande"));
    check("Malt : nouvelle demande → opportunité + alerte « Nouvelle demande Malt »", malt.status === "cree" && malt.alerted && /^Nouvelle demande Malt : Automatiser la saisie/.test(alerts.at(-1)?.title ?? "") && /Claire Fontaine/.test(alerts.at(-1)?.body ?? ""), JSON.stringify(alerts.at(-1)));
    const maltRow = opp(malt.opportunity_ids[0]);
    maltRow.status = "envoyee";
    const maltMessage = await ingestPlatformEmail(deps, byName("Malt — nouveau message du même"));
    check("Malt : message → rattaché (même projet), Réponse", maltMessage.status === "rattache" && maltMessage.opportunity_ids[0] === malt.opportunity_ids[0] && maltRow.status === "reponse", JSON.stringify(maltMessage));
    const maltWon = await ingestPlatformEmail(deps, byName("Malt — devis accepté"));
    check("Malt : devis accepté → Gagnée", maltWon.status === "rattache" && maltRow.status === "gagnee");
    const alertsBefore = alerts.length;
    const maltNew = await ingestPlatformEmail(deps, byName("Malt — message d'un client inconnu"));
    check("Malt : message d'un client inconnu → nouvelle demande + alerte", maltNew.status === "cree" && maltNew.kind === "demande" && maltNew.alerted && alerts.length === alertsBefore + 1, JSON.stringify(maltNew));

    const order = await ingestPlatformEmail(deps, byName("ComeUp — nouvelle commande"));
    const orderRow = opp(order.opportunity_ids[0]);
    check("ComeUp : commande → Gagnée, montant 120 €, alerte « Nouvelle commande »", order.alerted && orderRow.status === "gagnee" && orderRow.amount_eur === 120 && typeof orderRow.won_at === "string" && /^Nouvelle commande ComeUp/.test(alerts.at(-1)?.title ?? ""), JSON.stringify({ status: orderRow.status, amount: orderRow.amount_eur }));
    const custom = await ingestPlatformEmail(deps, byName("ComeUp — demande personnalisée"));
    check("ComeUp : demande personnalisée → opportunité + alerte", custom.status === "cree" && custom.alerted);
    const orderMessage = await ingestPlatformEmail(deps, byName("ComeUp — message du client"));
    check("ComeUp : message sur la commande → rattaché, Gagnée gardée", orderMessage.status === "rattache" && orderMessage.opportunity_ids[0] === order.opportunity_ids[0] && orderRow.status === "gagnee" && !orderMessage.alerted, JSON.stringify(orderMessage));

    check("alertes uniquement pour invitation, demandes et commande (5)", alerts.length === 5, alerts.map((alert) => alert.title).join(" | "));
    check("chaque e-mail tracé une seule fois (16 lignes)", db.rows("opportunity_emails").length === EMAIL_FIXTURES.length && new Set(db.rows("opportunity_emails").map((row) => row.message_id)).size === EMAIL_FIXTURES.length);

    console.log("\n9. Cockpit : par plateforme, 7 et 30 jours");
    const now = new Date("2026-10-10T12:00:00Z");
    const week = platformActivity(db.rows("opportunities") as never, 7, now);
    const upwork = week.find((row) => row.platform === "upwork");
    const malt7 = week.find((row) => row.platform === "malt");
    check("Upwork 7 j : 2 envoyées, 2 réponses, 1 conversation, 1 gagnée", upwork?.sent === 2 && upwork.replies === 2 && upwork.conversations === 1 && upwork.won === 1, JSON.stringify(upwork));
    check("Malt 7 j : 1 gagnée", malt7?.won === 1, JSON.stringify(malt7));
    const old = [{ platform: "codeur", status: "gagnee", sent_at: "2026-09-20T10:00:00Z", replied_at: "2026-09-21T10:00:00Z", updated_at: "2026-09-25T10:00:00Z", conversation_at: null, won_at: null }];
    const codeur30 = platformActivity(old as never, 30, now)[0];
    check("ancienne fiche sans jalons datés : 30 j la compte, 7 j non", codeur30?.won === 1 && codeur30.sent === 1 && platformActivity(old as never, 7, now).length === 0, JSON.stringify(codeur30));
  }

  console.log(failures === 0 ? "\nTous les tests plateformes passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
