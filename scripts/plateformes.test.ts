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
import { parseInboundEmail, parsePlatformEmail, platformOfSender, htmlToText, withoutLinks, type InboundEmail } from "../lib/opportunities/email/parse";
import { codeurProjectDescription, decideEmail, ingestPlatformEmail, planPlatformEmail, statusAfterEvent } from "../lib/opportunities/email/ingest-email";
import { prefilterReason, titleOnlyReason } from "../lib/opportunities/prefilter";
import { EMAIL_STATUSES, needsProposal, opportunityFromEmail, parseTriageCreate, statusForKind } from "../lib/opportunities/email/triage";
import { emailsToSort, suggestedPrice } from "../lib/opportunities/email/view";
import { freelanceSources, platformActivity } from "../lib/opportunities/stats";
import { buildOpportunityPatch, parseNewOpportunity, titleFromBody } from "../lib/opportunities/input";
import { requestedItems } from "../lib/opportunities/requests";
import { STATUS_LABELS } from "../lib/opportunities/types";
import type { AskFn } from "../lib/ai/chat";
import type { Notification } from "../lib/notify/ntfy";
import { FakeDb } from "./fake-supabase";
import { CODEUR_EMAIL_FIXTURES, CODEUR_PROJECT_FIXTURES, EMAIL_FIXTURES } from "./fixtures/opportunity-emails";
import { ingestOpportunity, shouldAlertAfterPaste, TITLE_ONLY_NOTE } from "../lib/opportunities/ingest";
import { bucketOf, SIZE_BADGE, sizeFlag } from "../lib/opportunities/view";
import { buildFollowUpPrompt, dueFollowUps, fallbackFollowUp, followUpDue, followUpFailures, generateFollowUp } from "../lib/opportunities/follow-up";

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
    // Budget non indiqué : aucun prix de lancement imposé (Cowork #22), l'enchère du rédacteur est gardée.
    const outcome = await generateProposal({ ask, platform: "upwork", language: "en", title: item.title, body: item.ad, budget: null, need: "Support chatbot", demo: item.demo });
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

  console.log("\n10. Mode test /ingest-email (dry_run) : l'analyse, sans rien écrire");
  {
    const db = new FakeDb({ opportunities: [], opportunity_emails: [] });
    const alerts: Notification[] = [];
    let llm = 0;
    const ask: AskFn = async () => {
      llm += 1;
      return JSON.stringify({ score: 8, reasons: ["a", "b", "c"], need: "x", demo: "general", language: "en", kind: "automatisation" });
    };
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-07T12:00:00Z"), notify: async (notification: Notification) => (alerts.push(notification), true) };
    const byName = (prefix: string) => EMAIL_FIXTURES.find((fixture) => fixture.name.startsWith(prefix))!.email;
    const snapshot = () => JSON.stringify(db.tables);

    const before = snapshot();
    const invitation = await planPlatformEmail(deps, byName("Upwork — invitation"));
    check(
      "invitation : créerait une fiche, avec alerte — rien d'écrit, aucun appel, aucune alerte",
      invitation.dry_run && invitation.action === "cree" && invitation.would_alert && invitation.kind === "invitation" && invitation.parsed.external_id === "~01a2b3c4d5e6f7a8b9" && snapshot() === before && llm === 0 && alerts.length === 0,
      JSON.stringify(invitation),
    );
    const commande = await planPlatformEmail(deps, byName("ComeUp — nouvelle commande"));
    check("commande ComeUp : fiche « Gagnée » prévue, alerte prévue, montant lu", commande.action === "cree" && commande.opportunity_status === "gagnee" && commande.would_alert && commande.parsed.amount_eur === 120);
    const unknown = await planPlatformEmail(deps, byName("Expéditeur inconnu"));
    check("expéditeur inconnu : « à trier » avec la raison", unknown.action === "a_trier" && unknown.reason === "expéditeur inconnu" && !unknown.would_alert);
    const reco = await planPlatformEmail(deps, byName("Upwork — recommandations"));
    check("recommandations : 2 annonces listées, aucune créée", reco.action === "recommandations" && reco.parsed.jobs.length === 2 && db.rows("opportunities").length === 0);
    const maltUnknown = await planPlatformEmail(deps, byName("Malt — message d'un client inconnu"));
    check("Malt, message sans fiche : deviendrait une nouvelle demande avec alerte", maltUnknown.action === "cree" && maltUnknown.kind === "demande" && maltUnknown.would_alert);

    // Une vraie ingestion, puis le mode test sur le message de suivi et sur le même e-mail rejoué.
    const real = await ingestPlatformEmail(deps, byName("Upwork — invitation"));
    db.rows("opportunities")[0].status = "envoyee";
    const afterReal = snapshot();
    const alertsAfterReal = alerts.length;
    const message = await planPlatformEmail(deps, byName("Upwork — nouveau message"));
    check(
      "message de suivi : rattacherait à la fiche visée, statut prévu « Réponse », sans alerte",
      message.action === "rattache" && message.target?.id === real.opportunity_ids[0] && message.target.status === "envoyee" && message.opportunity_status === "reponse" && !message.would_alert,
      JSON.stringify(message),
    );
    const replay = await planPlatformEmail(deps, byName("Upwork — invitation"));
    check("message_id déjà reçu : « doublon », fiche liée renvoyée", replay.action === "doublon" && replay.duplicate && replay.target?.id === real.opportunity_ids[0]);
    check("aucune écriture ni alerte pendant les essais à blanc", snapshot() === afterReal && alerts.length === alertsAfterReal);
    const decided = decideEmail(parsePlatformEmail(byName("Upwork — offre")), { id: "o1", status: "reponse" });
    check("décision partagée : une offre sur « Réponse » → Conversation", decided.action === "rattache" && decided.status === "entretien" && decided.statusChanged);
  }

  console.log("\n11. Vue « À trier » : créer une fiche, rattacher, ignorer");
  {
    const email = { id: "e1", subject: 'Re: "Automatiser nos devis Excel"', excerpt: "Bonjour,\nPaul Martin souhaite vous confier un projet.\nBudget : 900 €\nNous voulons générer nos devis à partir d'un fichier Excel.", from_address: "contact@exemple.fr", received_at: "2026-10-07T09:00:00Z", external_id: null };
    const demande = opportunityFromEmail(email, "malt", "demande", "u1");
    check("demande : titre du sujet, statut « À répondre », budget et client lus", demande.title === "Automatiser nos devis Excel" && demande.status === "a_repondre" && demande.budget === "900 €" && demande.client_name === "Paul Martin" && demande.source === "email", JSON.stringify(demande));
    check("identifiant stable quand l'e-mail n'en donne pas", demande.external_id === "email-tri:e1");
    const commande = opportunityFromEmail(email, "comeup", "commande", "u1");
    check("commande : « Gagnée », jalons posés à la date de l'e-mail", commande.status === "gagnee" && commande.won_at === email.received_at && commande.sent_at === email.received_at);
    check("offre → Conversation, message → Réponse", statusForKind("offre") === "entretien" && statusForKind("message") === "reponse");
    check("seules demande et invitation passent par l'analyse et la proposition", needsProposal("demande") && needsProposal("invitation") && !needsProposal("commande") && !needsProposal("message"));
    check("création : plateforme et type obligatoires", !parseTriageCreate({ platform: "fiverr", kind: "demande" }).ok && !parseTriageCreate({ platform: "malt", kind: "autre" }).ok && parseTriageCreate({ platform: "malt", kind: "demande" }).ok);
    check("« ignorer » est un statut, pas une suppression", EMAIL_STATUSES.includes("ignore"));
    const sortable = emailsToSort([
      { id: "1", status: "a_trier" },
      { id: "2", status: "ignore" },
      { id: "3", status: "rattache" },
    ] as never);
    check("onglet « À trier » : seulement les e-mails encore à trier", sortable.length === 1 && sortable[0].id === "1");
  }

  console.log("\n12. Résumé du Cockpit : Codeur, Upwork, Malt/ComeUp, taux de réponse 30 j");
  {
    const now = new Date("2026-10-10T12:00:00Z");
    const rows = [
      { platform: "codeur", sent_at: "2026-10-01T10:00:00Z", replied_at: "2026-10-02T10:00:00Z" },
      { platform: "codeur", sent_at: "2026-10-05T10:00:00Z", replied_at: null },
      { platform: "codeur", sent_at: "2026-08-01T10:00:00Z", replied_at: "2026-08-02T10:00:00Z" },
      { platform: "malt", sent_at: "2026-10-03T10:00:00Z", replied_at: "2026-10-04T10:00:00Z" },
      { platform: "comeup", sent_at: "2026-10-04T10:00:00Z", replied_at: null },
      { platform: "upwork", sent_at: null, replied_at: null },
    ];
    const sources = freelanceSources(rows as never, now);
    check("3 sources, dans l'ordre Codeur, Upwork, Malt/ComeUp", sources.map((source) => source.label).join(",") === "Codeur,Upwork,Malt/ComeUp");
    check("Codeur : 2 envoyées sur 30 j (l'ancienne exclue), 50 %", sources[0].sent === 2 && sources[0].replyRate === 0.5, JSON.stringify(sources[0]));
    check("Upwork : rien envoyé → taux « — » (null)", sources[1].sent === 0 && sources[1].replyRate === null);
    check("Malt et ComeUp réunis : 2 envoyées, 50 %", sources[2].sent === 2 && sources[2].replyRate === 0.5);
  }

  console.log("\n13. E-mails Codeur : suivi des projets connus par le flux RSS");
  {
    for (const fixture of CODEUR_EMAIL_FIXTURES) {
      const parsed = parsePlatformEmail(fixture.email);
      const expect = fixture.expect;
      const diffs = [
        parsed.platform !== expect.platform && `platform=${parsed.platform}`,
        parsed.kind !== expect.kind && `kind=${parsed.kind}`,
        expect.externalId !== undefined && parsed.externalId !== expect.externalId && `externalId=${parsed.externalId}`,
        expect.client !== undefined && parsed.clientName !== expect.client && `client=${parsed.clientName}`,
      ].filter(Boolean);
      check(`${fixture.name} → ${expect.kind}`, diffs.length === 0, diffs.join(", "));
    }
    const rssRow = (id: string, external: string, title: string) => ({ id, user_id: "u1", platform: "codeur", source: "rss", external_id: external, title, status: "envoyee", sent_at: "2026-10-03T10:00:00Z", replied_at: null, conversation_at: null, won_at: null, client_name: null, url: `https://www.codeur.com/projects/${external}-x`, created_at: "2026-10-03T09:00:00Z" });
    const db = new FakeDb({
      opportunities: [rssRow("c1", "490123", "Automatiser le tri de nos e-mails de commande"), rssRow("c2", "490456", "Chatbot pour notre site immobilier"), { ...rssRow("c3", "490789", "Extraction de factures PDF vers Excel"), status: "gagnee" }],
      opportunity_emails: [],
    });
    const alerts: Notification[] = [];
    let llm = 0;
    const deps = { db: db as never, userId: "u1", ask: (async () => ((llm += 1), "")) as AskFn, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-08T12:00:00Z"), notify: async (notification: Notification) => (alerts.push(notification), true) };
    const byName = (prefix: string) => CODEUR_EMAIL_FIXTURES.find((fixture) => fixture.name.startsWith(prefix))!.email;
    const row = (id: string) => db.rows("opportunities").find((item) => item.id === id) as Record<string, unknown>;

    const dry = await planPlatformEmail(deps, byName("Codeur — message du client"));
    check("dry_run Codeur : rattacherait au projet 490123, « Réponse », alerte prévue", dry.action === "rattache" && dry.target?.id === "c1" && dry.opportunity_status === "reponse" && dry.would_alert, JSON.stringify(dry));
    const message = await ingestPlatformEmail(deps, byName("Codeur — message du client"));
    check("message client → rattaché par l'identifiant de projet, « Réponse », alerte « Message client »", message.status === "rattache" && message.opportunity_ids[0] === "c1" && row("c1").status === "reponse" && typeof row("c1").replied_at === "string" && message.alerted && /^Message client Codeur : Automatiser le tri/.test(alerts[0]?.title ?? ""), JSON.stringify({ message, alert: alerts[0] }));
    const won = await ingestPlatformEmail(deps, byName("Codeur — projet attribué"));
    check("projet attribué → « Gagnée » (won_at), alerte « Projet attribué »", won.status === "rattache" && row("c1").status === "gagnee" && typeof row("c1").won_at === "string" && won.alerted && /^Projet attribué Codeur/.test(alerts[1]?.title ?? ""), JSON.stringify(won));
    const lost = await ingestPlatformEmail(deps, byName("Codeur — offre non retenue"));
    check("offre non retenue → « Perdue », sans alerte", lost.status === "rattache" && row("c2").status === "perdue" && !lost.alerted);
    const closed = await ingestPlatformEmail(deps, byName("Codeur — projet clos"));
    check("projet clos sur une mission gagnée → reste « Gagnée », sans alerte", closed.status === "rattache" && row("c3").status === "gagnee" && !closed.alerted);
    const unknown = await ingestPlatformEmail(deps, byName("Codeur — message sur un projet inconnu"));
    check("projet inconnu d'ORION → « à trier », aucune fiche créée, sans alerte", unknown.status === "a_trier" && db.rows("opportunities").length === 3 && !unknown.alerted);
    check("Codeur : jamais d'appel au modèle, 2 alertes au total", llm === 0 && alerts.length === 2);
  }

  console.log("\n14. Relances suggérées : 3 j (Codeur, Malt, ComeUp), 5 j (Upwork)");
  {
    const now = new Date("2026-10-10T12:00:00Z");
    const sent = (platform: string, sentAt: string, extra: Record<string, unknown> = {}) => ({ platform, status: "envoyee", sent_at: sentAt, replied_at: null, followed_up_at: null, ...extra }) as never;
    check("Codeur envoyée il y a 3 j → relance due", followUpDue(sent("codeur", "2026-10-07T10:00:00Z"), now));
    check("Codeur envoyée il y a 2 j → pas encore", !followUpDue(sent("codeur", "2026-10-08T13:00:00Z"), now));
    check("Malt 3 j, ComeUp 3 j → dues", followUpDue(sent("malt", "2026-10-07T10:00:00Z"), now) && followUpDue(sent("comeup", "2026-10-07T10:00:00Z"), now));
    check("Upwork 4 j → pas encore ; 5 j → due", !followUpDue(sent("upwork", "2026-10-06T10:00:00Z"), now) && followUpDue(sent("upwork", "2026-10-05T10:00:00Z"), now));
    check("réponse reçue, déjà relancée ou statut avancé → plus due", !followUpDue(sent("codeur", "2026-10-01T10:00:00Z", { replied_at: "2026-10-02T10:00:00Z" }), now) && !followUpDue(sent("codeur", "2026-10-01T10:00:00Z", { followed_up_at: "2026-10-05T10:00:00Z" }), now) && !followUpDue(sent("codeur", "2026-10-01T10:00:00Z", { status: "reponse" }), now));
    check("compte des relances dues (Cockpit)", dueFollowUps([sent("codeur", "2026-10-01T10:00:00Z"), sent("upwork", "2026-10-09T10:00:00Z"), sent("malt", "2026-10-02T10:00:00Z")], now).length === 2);
    const marked = buildOpportunityPatch({ followed_up: true }, { status: "envoyee", sent_at: "x", replied_at: null }, now);
    check("« Marquer relancée » pose followed_up_at, sans toucher au statut", marked.ok && marked.patch.followed_up_at === now.toISOString() && !("status" in marked.patch));

    check("règles : 400 caractères au plus", followUpFailures("x".repeat(400), "upwork").some((line) => /400 caractères/.test(line)) && followUpFailures("x".repeat(399), "upwork").length === 0);
    check("Codeur, Malt, ComeUp : aucune URL ; Upwork : lien toléré, jamais d'e-mail", followUpFailures("Voir axelremillat.com", "codeur").length > 0 && followUpFailures("See axelremillat.com", "upwork").length === 0 && followUpFailures("mail me: axel@exemple.fr", "upwork").length > 0);
    const opp = { platform: "codeur" as const, title: "Automatiser le tri de nos e-mails de commande", need: "Trier 80 e-mails par jour", proposal: "Bonjour, …", language: "fr" as const };
    const good: AskFn = async () => JSON.stringify({ text: "Bonjour, avez-vous pu regarder ma proposition pour le tri de vos 80 e-mails de commande quotidiens ? Je peux démarrer dès lundi.\n\nAxel Remillat" });
    const llmText = await generateFollowUp(good, opp);
    check("texte rédigé par le modèle gardé s'il passe les règles", llmText.source === "llm" && llmText.text.length < 400);
    let calls = 0;
    const bad: AskFn = async () => ((calls += 1), JSON.stringify({ text: "Bonjour, voir www.axelremillat.com ou appelez le 07 49 72 71 92." }));
    const fallback = await generateFollowUp(bad, opp);
    check("coordonnées refusées deux fois → texte de repli sûr (FR, < 400, sans URL)", fallback.source === "fallback" && calls === 2 && fallback.text.length < 400 && followUpFailures(fallback.text, "codeur").length === 0 && fallback.text.startsWith("Bonjour"), fallback.text);
    const upworkFallback = fallbackFollowUp({ platform: "upwork", title: "x".repeat(200) }, "en");
    check("repli Upwork en anglais, titre coupé, < 400 caractères", upworkFallback.startsWith("Hi,") && upworkFallback.length < 400 && followUpFailures(upworkFallback, "upwork").length === 0, String(upworkFallback.length));
    check("consigne : aucune URL demandée sur Codeur", /TOUTE URL/.test(buildFollowUpPrompt("codeur", "fr")) && !/TOUTE URL/.test(buildFollowUpPrompt("upwork", "en")));
  }

  console.log("\n15. Codeur « Nouveau projet » : filet de sécurité du flux RSS");
  {
    const [known, relevant, offTarget] = CODEUR_PROJECT_FIXTURES;
    for (const fixture of CODEUR_PROJECT_FIXTURES) {
      const parsed = parsePlatformEmail(fixture.email);
      check(`${fixture.name} : reconnu « nouveau_projet », identifiant ${fixture.externalId}`, parsed.platform === "codeur" && parsed.kind === "nouveau_projet" && parsed.externalId === fixture.externalId && parsed.title === fixture.email.subject.replace("Nouveau projet : ", ""), JSON.stringify({ kind: parsed.kind, id: parsed.externalId, title: parsed.title }));
    }
    check("expéditeur notification@compte.codeur.com → Codeur", platformOfSender("Codeur.com <notification@compte.codeur.com>") === "codeur");
    // Le flux RSS a déjà livré 490913 (même ligne que /api/opportunities/ingest l'aurait écrite).
    const rss = { id: "rss-490913", user_id: "u1", platform: "codeur", source: "rss", external_id: "490913", title: "Recherche développeur", status: "a_repondre", fit_score: 7, created_at: "2026-10-07T17:30:00Z", sent_at: null, replied_at: null, conversation_at: null, won_at: null, client_name: null, url: "https://www.codeur.com/projects/490913-recherche-developpeur" };
    const db = new FakeDb({ opportunities: [rss], opportunity_emails: [] });
    const alerts: Notification[] = [];
    const llm: string[] = [];
    const ask: AskFn = async (role, system, _user, _t, operation) => {
      llm.push(String(operation));
      if (/Tu analyses une annonce/.test(system)) return JSON.stringify({ score: 9, reasons: ["factures PDF", "Pennylane", "volume clair"], need: "Extraire les factures", demo: "factures", language: "fr", kind: "automatisation" });
      return "";
    };
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-07T18:00:00Z"), notify: async (notification: Notification) => (alerts.push(notification), true) };

    const before = JSON.stringify(db.tables);
    const dryKnown = await planPlatformEmail(deps, known.email);
    const dryNew = await planPlatformEmail(deps, relevant.email);
    check("dry_run : connu → « doublon » (fiche du flux RSS en cible)", dryKnown.action === "doublon" && dryKnown.target?.id === "rss-490913" && !dryKnown.would_alert, JSON.stringify(dryKnown));
    check("dry_run : inconnu → « cree », rien d'écrit, aucun appel", dryNew.action === "cree" && dryNew.kind === "nouveau_projet" && JSON.stringify(db.tables) === before && llm.length === 0, JSON.stringify(dryNew));

    const duplicate = await ingestPlatformEmail(deps, known.email);
    check("connu : « doublon », RIEN d'écrit (pas même l'e-mail), aucune alerte, aucun appel", duplicate.status === "doublon" && duplicate.duplicate === true && duplicate.opportunity_ids[0] === "rss-490913" && JSON.stringify(db.tables) === before && alerts.length === 0 && llm.length === 0, JSON.stringify(duplicate));

    // Référence : le même e-mail passé par /api/opportunities/ingest (même pipeline) sur une base vide.
    const reference = new FakeDb({ opportunities: [] });
    const viaRss = await ingestOpportunity({ ...deps, db: reference as never, notify: undefined }, { platform: "codeur", external_id: "491020", url: "https://www.codeur.com/projects/491020-automatiser-la-saisie-de-nos-factures-fournisseurs", title: "Automatiser la saisie de nos factures fournisseurs", description: parsePlatformEmail(relevant.email).body, description_truncated: true, budget_text: "1 000 € à 2 000 €", categories: [], published_at: relevant.email.received_at });
    const created = await ingestPlatformEmail(deps, relevant.email);
    const row = db.rows("opportunities").find((item) => item.id === created.opportunity_ids[0]) as Record<string, unknown>;
    check("inconnu pertinent : fiche créée par le chemin de /ingest (même verdict et score)", created.status === "cree" && created.verdict === viaRss.verdict && created.score === viaRss.score && created.verdict === "alerte" && row.external_id === "491020" && row.platform === "codeur" && row.description_truncated === true, JSON.stringify({ created, viaRss: { verdict: viaRss.verdict, score: viaRss.score } }));
    check("… titre et extrait de l'e-mail comme annonce, lien du projet gardé", row.title === "Automatiser la saisie de nos factures fournisseurs" && /150 factures PDF/.test(String(row.body)) && row.url === "https://www.codeur.com/projects/491020-automatiser-la-saisie-de-nos-factures-fournisseurs");
    check("… alerte au même seuil que la veille (score 9 ≥ 8)", created.alerted && alerts.length === 1 && /^Nouvelle offre Codeur \(9\/10\) : Automatiser la saisie/.test(alerts[0].title), JSON.stringify(alerts[0]));

    const llmBefore = llm.length;
    const filtered = await ingestPlatformEmail(deps, offTarget.email);
    const filteredRow = db.rows("opportunities").find((item) => item.id === filtered.opportunity_ids[0]) as Record<string, unknown>;
    void llmBefore;
    // Cowork #27 : un CMS est une mission de lancement → alerte.
    check("inconnu sur CMS (WordPress) : même pré-filtre → alerte « lancement » (Cowork #27)", filtered.status === "cree" && filtered.verdict === "alerte" && filteredRow.status !== "ignoree" && !filteredRow.filter_reason && alerts.length === 2, JSON.stringify({ filtered, reason: filteredRow?.filter_reason }));
    const replay = await ingestPlatformEmail(deps, relevant.email);
    check("e-mail rejoué : doublon par message_id, rien refait", replay.duplicate === true && db.rows("opportunities").length === 3 && alerts.length === 2);
    const noId = parsePlatformEmail({ ...relevant.email, message_id: "<x>", text: "Nouveau projet sans lien." });
    check("« Nouveau projet » sans identifiant → à trier", decideEmail(noId, null).action === "a_trier");
  }

  console.log("\n16. Repère de taille : « Trop gros seul : lot IA ou sous-traitance »");
  {
    check("« Plus de 10 000 € » → badge", sizeFlag({ budget: "Plus de 10 000 €" }) !== null);
    check("« 10 000 € à 30 000 € » → badge", sizeFlag({ budget: "10 000 € à 30 000 €" }) !== null);
    check("« 1 000 à 30 000 € » (tranche large) → pas de badge", sizeFlag({ budget: "1 000 à 30 000 €" }) === null);
    check("tranche Codeur « 1 000 € à 10 000 € » → pas de badge", sizeFlag({ budget: "1 000 € à 10 000 €" }) === null);
    check("« $12,000 fixed » → badge ; « 15k€ » → badge", sizeFlag({ budget: "$12,000 fixed" }) !== null && sizeFlag({ budget: "15k€" }) !== null);
    check("« 9 500 € » ou budget absent → pas de badge", sizeFlag({ budget: "9 500 €" }) === null && sizeFlag({ budget: null }) === null && sizeFlag({}) === null);
    check("besoin estimé 42 jours → badge ; 30 jours → non", /42 jours/.test(sizeFlag({ suggested_delay_days: 42 }) ?? "") && sizeFlag({ suggested_delay_days: 30 }) === null);
    check("texte sans devise (« 12 pages ») → pas de badge", sizeFlag({ budget: "12 pages, 20000 visiteurs" }) === null);
    check("libellé exact du badge", SIZE_BADGE === "Trop gros seul : lot IA ou sous-traitance");
    const row = { fit_score: 9, status: "a_repondre" as const, budget: "Plus de 10 000 €" };
    check("le score et le classement ne changent pas", bucketOf(row) === "alertes" && row.fit_score === 9);
  }

  console.log("\n17. Format réel de l'alerte Codeur (08/10) et « Non analysée », jamais « Ignorée »");
  {
    // Même structure que les vrais e-mails du 08/10 (logo, liens de suivi, pied de page) ; identifiants fictifs.
    const realFormat: InboundEmail = {
      message_id: "<alerte-reelle-0001@compte.codeur.com>",
      from: "Codeur.com <notification@compte.codeur.com>",
      subject: "Nouveau projet : Application ia agentiques",
      text: [
        "Un projet dans vos compétences vient d’être publié. Codeur.com",
        "[https://www.codeur.com/system/images/files/000/000/363/original/logo-codeur-ico-90.png?1572951492]",
        "https://www.codeur.com/projects/499001-application-ia-agentiques",
        "",
        "Nouveau projet publié",
        "",
        "Projet :  Application ia agentiques",
        "[https://www.codeur.com/projects/499001-application-ia-agentiques?utm_campaign=KeywordAlert&utm_medium=email&utm_source=codeur]",
        "",
        "Déposer une offre",
        "[https://www.codeur.com/projects/499001-application-ia-agentiques?utm_campaign=KeywordAlert&utm_medium=Email&utm_source=codeur]",
        "",
        "Vous pouvez filtrer les projets [https://www.codeur.com/edit-email-alerts] de",
        "cette alerte selon vos compétences ou par mots-clés.",
        "",
        "À bientôt sur Codeur.com !",
        "",
        "Vous recevez ce mail car vous êtes inscrit à notre liste de diffusion. Si vous",
        "souhaitez ne plus recevoir cette alerte email vous avez la possibilité de vous",
        "désinscrire : Se désinscrire [https://www.codeur.com/email_alerts/xxxx/unsubscribe]",
      ].join("\n"),
      html: "",
      received_at: "2026-10-08T12:42:47Z",
    };
    const parsed = parsePlatformEmail(realFormat);
    check("reconnu « nouveau_projet », identifiant 499001, titre du sujet", parsed.kind === "nouveau_projet" && parsed.externalId === "499001" && parsed.title === "Application ia agentiques", JSON.stringify({ kind: parsed.kind, id: parsed.externalId, title: parsed.title }));
    check("corps sans lien ni pied de page (le logo ne passe plus)", !/https?:|logo|diffusion|désinscrire/i.test(parsed.body), parsed.body);
    check("annonce = le titre seul (l'alerte ne donne rien d'autre)", codeurProjectDescription(parsed.body, "Application ia agentiques") === "Application ia agentiques", codeurProjectDescription(parsed.body, "Application ia agentiques"));
    check("cause du 08/10 reproduite : l'URL du logo déclenchait « graphisme, design »", /graphisme/.test(prefilterReason({ title: "Application ia agentiques", description: "[https://www.codeur.com/system/images/files/original/logo-codeur-ico-90.png]", categories: [], budgetText: null }) ?? ""));
    check("withoutLinks : liens entre crochets et nus retirés, texte gardé", withoutLinks("Voir [https://x.fr/a?b=1] ici https://y.fr/z et là") === "Voir ici et là");
    check("recommandations Upwork : les annonces se lisent toujours (liens du texte brut)", parsePlatformEmail(EMAIL_FIXTURES.find((fixture) => fixture.expect.kind === "recommandation")!.email).jobs.length === 2);

    const db = new FakeDb({ opportunities: [], opportunity_emails: [] });
    const alerts: Notification[] = [];
    const seen: string[] = [];
    const ask: AskFn = async (role, system, user) => {
      if (/Tu analyses une annonce/.test(system)) {
        seen.push(user);
        return JSON.stringify({ score: 9, reasons: ["agents IA", "cœur de métier", "à préciser"], need: "Application d'agents IA", demo: "general", language: "fr", kind: "automatisation" });
      }
      return "";
    };
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-08T12:43:00Z"), notify: async (notification: Notification) => (alerts.push(notification), true) };
    const created = await ingestPlatformEmail(deps, realFormat);
    const row = db.rows("opportunities")[0] as Record<string, unknown>;
    // Plateformes #11 : l'alerte ne donne que le titre → « À voir » SANS analyse (un score sur un titre ne veut rien dire).
    // 11/10/2026 : « Application ia agentiques » est une mission de lancement (application web, budget non indiqué) →
    // alerte tout de suite, toujours SANS analyse (titre seul).
    check("format réel → pas filtré, « Titre seul », mission de lancement : alerte, sans appel au modèle", created.verdict === "alerte" && created.status === "cree" && !row.filter_reason && row.analysis_state === "titre_seul" && row.fit_score == null && bucketOf(row as never, deps.now()) === "alertes" && created.alerted && alerts.length === 1 && seen.length === 0, JSON.stringify({ created, state: row?.analysis_state, reason: row?.filter_reason }));
    check("… lien de l'annonce gardé, annonce = le titre", row.url === "https://www.codeur.com/projects/499001-application-ia-agentiques" && row.body === "Application ia agentiques" && row.description_truncated === true, JSON.stringify({ url: row.url, body: row.body }));

    // Analyse impossible (erreur API, budget, réponse illisible) : « Non analysée », jamais « Ignorée ».
    const down: AskFn = async () => {
      throw new Error("500 server error");
    };
    const dbDown = new FakeDb({ opportunities: [], opportunity_emails: [] });
    // Alerte AVEC un extrait (l'analyse doit tourner) — elle échoue : « Non analysée ».
    const viaEmail = await ingestPlatformEmail({ ...deps, db: dbDown as never, ask: down }, CODEUR_PROJECT_FIXTURES[1].email);
    const downRow = dbDown.rows("opportunities")[0] as Record<string, unknown>;
    check("chemin e-mail, erreur API → « Non analysée », jamais « Ignorée », pas d'alerte", downRow.analysis_state === "non_analysee" && downRow.status !== "ignoree" && viaEmail.verdict === "a_voir" && !viaEmail.alerted, JSON.stringify({ state: downRow.analysis_state, status: downRow.status, verdict: viaEmail.verdict }));
    const dbRss = new FakeDb({ opportunities: [] });
    const viaRss = await ingestOpportunity({ ...deps, db: dbRss as never, ask: down, notify: undefined }, { platform: "codeur", external_id: "499003", url: null, title: "CRM sur mesure avec agents IA", description: "Un CRM sur mesure avec des agents IA pour nos commerciaux.", description_truncated: true, budget_text: null, categories: [], published_at: null });
    const rssRow = dbRss.rows("opportunities")[0] as Record<string, unknown>;
    check("chemin RSS, erreur API → « Non analysée », jamais « Ignorée »", rssRow.analysis_state === "non_analysee" && rssRow.status !== "ignoree" && viaRss.not_analyzed === true, JSON.stringify({ state: rssRow.analysis_state, status: rssRow.status }));
    const unreadable: AskFn = async () => "pas du JSON";
    const dbBad = new FakeDb({ opportunities: [] });
    await ingestOpportunity({ ...deps, db: dbBad as never, ask: unreadable, notify: undefined }, { platform: "codeur", external_id: "499004", url: null, title: "Agent IA de tri des e-mails", description: "Trier nos e-mails entrants avec un agent IA.", description_truncated: true, budget_text: null, categories: [], published_at: null });
    check("réponse illisible du modèle → « Non analysée » aussi", (dbBad.rows("opportunities")[0] as Record<string, unknown>).analysis_state === "non_analysee");
  }

  console.log("\n18. Alerte Codeur à titre seul : « À voir », sans analyse (plateformes #11)");
  {
    const alertFor = (id: string, title: string): InboundEmail => ({
      message_id: `<titre-seul-${id}@compte.codeur.com>`,
      from: "Codeur.com <notification@compte.codeur.com>",
      subject: `Nouveau projet : ${title}`,
      text: `Un projet dans vos compétences vient d’être publié. Codeur.com\n[https://www.codeur.com/system/images/files/original/logo-codeur-ico-90.png]\nhttps://www.codeur.com/projects/${id}-x\n\nNouveau projet publié\n\nProjet :  ${title}\n\nDéposer une offre\n\nVous recevez ce mail car vous êtes inscrit à notre liste de diffusion.`,
      html: "",
      received_at: "2026-10-09T09:00:00Z",
    });
    let llm = 0;
    const ask: AskFn = async () => ((llm += 1), "");
    const db = new FakeDb({ opportunities: [], opportunity_emails: [] });
    const deps = { db: db as never, userId: "u1", ask, baseUrl: "https://orion.axelremillat.com", now: () => new Date("2026-10-09T09:01:00Z"), notify: async () => true };

    const wordpress = await ingestPlatformEmail(deps, alertFor("499101", "Refonte de notre site WordPress"));
    const wpRow = db.rows("opportunities").find((item) => item.id === wordpress.opportunity_ids[0]) as Record<string, unknown>;
    check("titre WordPress → alerte « lancement », jamais « Ignorée » (Cowork #27)", wordpress.verdict === "alerte" && wpRow.status !== "ignoree" && !wpRow.filter_reason);
    const mobile = await ingestPlatformEmail(deps, alertFor("499102", "Application iOS native en Swift"));
    check("titre « application iOS native » → « Ignorée »", mobile.verdict === "ignore");
    const ai = await ingestPlatformEmail(deps, alertFor("499103", "ERP"));
    const aiRow = db.rows("opportunities").find((item) => item.id === ai.opportunity_ids[0]) as Record<string, unknown>;
    check("titre non écarté (« ERP ») → « À voir », mention « Titre seul », aucun appel au modèle", ai.verdict === "a_voir" && aiRow.analysis_state === "titre_seul" && bucketOf(aiRow as never) === "a_voir" && llm === 0, JSON.stringify(ai));
    // Règles propres aux titres seuls (cas réels du 08/10).
    // « Ads » (Cowork #13) : la fiche « Recherche expert Google Ads / Microsoft Ads » était passée en « À voir ».
    for (const title of ["Recherche expert Google Ads / Microsoft Ads (Bing) expérience", "Campagnes Meta Ads pour une boutique", "Gestion de campagnes SEA"]) {
      check(`titre seul publicité en ligne : « ${title} » → écarté (marketing / publicité)`, /(marketing|publicité)/.test(titleOnlyReason(title) ?? ""), String(titleOnlyReason(title)));
    }
    check("« ads » ne touche pas un mot qui le contient (« Adresses », « uploads »)", titleOnlyReason("Automatiser la saisie des adresses de livraison") === null && titleOnlyReason("Gestion des uploads de documents clients") === null);
    for (const title of ["Videaste", "Gestion réseaux sociaux, vidéos et publicités", "Developper mon compte instagram", "Recherche data scientist", "Entreprise de nettoyage sur lyon", "Recherche développeur mobile"]) {
      check(`titre seul hors cible : « ${title} » → écarté`, titleOnlyReason(title) !== null);
    }
    for (const title of ["Application ia agentiques", "ERP", "Besoin d'une plate-forme de gestion parc motorisé d'une ferme.", "CRM pour école de danse", "Site de réservation PMR", "Je souhaite développer une plateforme web et mobile de loisirs", "Développeur / spécialiste IA & automatisation commerciale"]) {
      check(`titre seul dans la cible ou à voir : « ${title} » → gardé`, titleOnlyReason(title) === null, String(titleOnlyReason(title)));
    }
    check("mention exacte", TITLE_ONLY_NOTE ==="Titre seul : ouvrez l'annonce et collez le texte complet pour l'analyse");
    const dry = await planPlatformEmail(deps, alertFor("499104", "Agent IA pour nos devis"));
    check("dry_run : action « cree », sans alerte prévue", dry.action === "cree" && !dry.would_alert);

    // Annonce complète collée : l'analyse normale tourne ; alerte si ≥ 8 (et seulement depuis « Titre seul »).
    check("collage sur « Titre seul », score 8 → alerte", shouldAlertAfterPaste("titre_seul", 8));
    check("collage sur « Titre seul », score 7 → pas d'alerte", !shouldAlertAfterPaste("titre_seul", 7));
    check("« Régénérer » sur une fiche déjà analysée → jamais d'alerte", !shouldAlertAfterPaste("ok", 10) && !shouldAlertAfterPaste(null, 9));
    // Une ancienne note sur titre seul ne range plus la fiche dans « Ignorées ».
    check("ancienne note 4/10 sur titre seul → « À voir »", bucketOf({ fit_score: 4, status: "a_repondre", analysis_state: "titre_seul" }) === "a_voir" && bucketOf({ fit_score: 4, status: "a_repondre", analysis_state: "ok" }) === "ignorees");
    check("…sauf si le statut est « Ignorée » ou si le filtre l'a écartée", bucketOf({ fit_score: 4, status: "ignoree", analysis_state: "titre_seul" }) === "ignorees" && bucketOf({ fit_score: null, status: "a_repondre", analysis_state: "titre_seul", filter_reason: "x" }) === "ignorees");
  }

  console.log(failures === 0 ? "\nTous les tests plateformes passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
