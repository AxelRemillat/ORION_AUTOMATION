/**
 * Délivrabilité et palier d'envoi (Cowork #26) : paliers 25 → 30 → 40 → 50, point
 * délivrabilité, vérification Hunter avant envoi. Aucun réseau, aucun crédit réel.
 */
import { buildDeliverability, MAX_DAILY_CAP, unlockedDailyCap, type SentRow } from "../lib/outbox/deliverability";
import { AUTO_30_FROM_DAY, nextCap, nextRampStep } from "../lib/settings/ramp";
import { bounceKind, buildDeliverabilityReport, recommendation, weekOf } from "../lib/settings/deliverability-report";
import { checkRecipient, verdictOf, verifyKey, type HunterVerifierStatus, type RecipientDeps } from "../lib/outbox/recipient-check";
import { realRecipientDeps } from "../lib/outbox/recipient-check-server";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Un envoi réel par jour ouvré à partir du lundi 28/09/2026. */
const sentSince = (days: number): SentRow[] =>
  Array.from({ length: days }, (_, index) => {
    const date = new Date("2026-09-28T09:00:00Z");
    let added = 0;
    while (added < index) {
      date.setUTCDate(date.getUTCDate() + 1);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) added += 1;
    }
    return { status: "sent", sent_at: date.toISOString(), type: "intro", gmail_message_id: `g${index}` } as SentRow;
  });

async function main() {
  console.log("\n1. Paliers : 25 jusqu'au 15/10, 30 dès le 16/10, jamais 40 tout seul");
  const history = sentSince(1);
  check("mercredi 15/10 (jour 14) : 25", buildDeliverability(history, new Date("2026-10-15T10:00:00Z"), {}).dailyCap === 25);
  check("jeudi 16/10 (jour 15) : 30", buildDeliverability(history, new Date("2026-10-16T10:00:00Z"), {}).dailyCap === 30 && AUTO_30_FROM_DAY === 15);
  check("fin octobre, sans déblocage : toujours 30 (plus de 40 automatique)", buildDeliverability(history, new Date("2026-10-30T10:00:00Z"), {}).dailyCap === 30);
  check("déblocage manuel SEND_DAILY_CAP_UNLOCKED=40 : 40", buildDeliverability(history, new Date("2026-10-30T10:00:00Z"), { SEND_DAILY_CAP_UNLOCKED: "40" }).dailyCap === 40);
  check("déblocage pendant la montée en charge (jour 10) : ignoré", buildDeliverability(history, new Date("2026-10-09T10:00:00Z"), { SEND_DAILY_CAP_UNLOCKED: "40" }).dailyCap === 25);
  check("valeur hors échelle (60, « abc ») : ignorée, 50 au maximum", unlockedDailyCap({ SEND_DAILY_CAP_UNLOCKED: "60" }) === null && unlockedDailyCap({ SEND_DAILY_CAP_UNLOCKED: "abc" }) === null && MAX_DAILY_CAP === 50);
  check("échelle 25 → 30 → 40 → 50 → fin", nextCap(25) === 30 && nextCap(30) === 40 && nextCap(40) === 50 && nextCap(50) === null);

  console.log("\n2. Prochain palier et sa condition (Réglages › Délivrabilité)");
  const dns = { spf: true, dkim: true };
  const to30 = nextRampStep({ currentCap: 25, warmupDay: 12, sentTotal: 114, inbound: [], dnsOk: dns, now: new Date("2026-10-13T10:00:00Z") });
  check("à 25 : prochain palier 30, automatique au jour 15", to30.target === 30 && to30.automatic && /jour 15/.test(to30.how), to30.how);
  const to40 = nextRampStep({ currentCap: 30, warmupDay: 17, sentTotal: 200, inbound: [], dnsOk: dns });
  check("à 30 : prochain palier 40, jamais automatique, deux semaines propres exigées", to40.target === 40 && !to40.automatic && /SEND_DAILY_CAP_UNLOCKED=40/.test(to40.how) && !to40.ready && to40.conditions.some((item) => /Deux semaines/.test(item.label) && !item.ok));
  const clean = nextRampStep({ currentCap: 30, warmupDay: 25, sentTotal: 400, inbound: [], dnsOk: dns });
  check("à 30 après 11 jours propres : 40 prêt", clean.ready);
  check("à 50 : plus de palier", nextRampStep({ currentCap: 50, warmupDay: 60, sentTotal: 900, inbound: [], dnsOk: dns }).target === null);

  console.log("\n3. Point délivrabilité");
  check("rebond dur (5.1.1, « n'existe pas ») / mou (4.2.2, boîte pleine)", bounceKind({ subject: "Delivery Status Notification", body: "550 5.1.1 The email account does not exist" }) === "hard" && bounceKind({ subject: "Undeliverable", body: "452 4.2.2 Mailbox full" }) === "soft");
  check("semaine (lundi, Paris)", weekOf("2026-10-01T10:00:00Z") === "2026-09-28" && weekOf("2026-10-05T07:00:00Z") === "2026-10-05");
  const report = buildDeliverabilityReport({
    sent: [
      { id: "m1", type: "intro", sent_at: "2026-09-29T09:00:00Z", prospect_id: "p1" },
      { id: "m2", type: "intro", sent_at: "2026-10-06T09:00:00Z", prospect_id: "p2" },
      { id: "m3", type: "relance_1", sent_at: "2026-10-07T09:00:00Z", prospect_id: "p1" },
      { id: "m4", type: "reponse", sent_at: "2026-10-07T09:00:00Z", prospect_id: "p1" },
    ],
    inbound: [
      { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification", body: "550 5.1.1 jean@nominatif.fr does not exist", received_at: "2026-10-06T09:05:00Z" },
      { from_email: "jean@nominatif.fr", subject: "Re: devis", body: "stop", category: "refus", received_at: "2026-10-07T12:00:00Z", prospect_id: "p1" },
      { from_email: "contact@generique.fr", subject: "Re: devis", body: "Merci, appelons-nous jeudi.", category: "reponse", received_at: "2026-10-08T12:00:00Z", prospect_id: "p2" },
    ],
    prospects: [
      { id: "p1", email: "jean@nominatif.fr", email_type: "nominatif" },
      { id: "p2", email: "contact@generique.fr", email_type: "generique" },
    ],
    drafts: [
      { type: "intro", created_at: "2026-10-05T08:00:00Z", quality_score: 9 },
      { type: "intro", created_at: "2026-10-05T08:00:00Z", quality_score: 7 },
      { type: "intro", created_at: "2026-10-06T08:00:00Z", quality_score: 10 },
    ],
    now: new Date("2026-10-09T18:00:00Z"),
  });
  check("envois par semaine (la réponse à un client n'est pas un envoi de prospection)", report.weeks[0].intros === 1 && report.weeks[1].intros === 1 && report.weeks[1].relances === 1 && report.totals.intros + report.totals.relances === 3, JSON.stringify(report.weeks));
  check("rebond rattaché à l'adresse nominative", report.bouncesByKind.nominative.hard === 1 && report.unmatchedBounces === 0);
  check("réponse réelle, « stop » comptés à part", report.totals.replies === 1 && report.totals.stops === 1);
  check("mails prêts ≥ 9/10 par jour ouvré (2 sur 10 jours ouvrés)", Math.abs(report.readyPerBusinessDay - 0.2) < 1e-9, String(report.readyPerBusinessDay));
  check("trop peu d'envois : ne pas monter", !recommendation(report, 30).go);

  console.log("\n4. Vérification Hunter avant envoi (aucun appel réel)");
  check("verdicts : invalid → bloquée ; accept_all / unknown → risquée ; valid / webmail → ok", verdictOf("invalid") === "bloquee" && verdictOf("accept_all") === "risquee" && verdictOf("unknown") === "risquee" && verdictOf("valid") === "ok" && verdictOf("webmail") === "ok");
  const cache = new Map<string, { status: HunterVerifierStatus }>();
  let calls = 0;
  const fake = (status: HunterVerifierStatus | null): RecipientDeps => ({
    read: async (key) => cache.get(key) ?? null,
    write: async (key, value) => void cache.set(key, { status: value.status }),
    verify: async () => ((calls += 1), { status, quotaExceeded: false }),
  });
  const first = await checkRecipient("Contact@Exemple.fr", fake("invalid"));
  const again = await checkRecipient("contact@exemple.fr", fake("valid"));
  check("invalid → bloquée, avec le motif", first.verdict === "bloquee" && /invalide/.test(first.reason ?? ""));
  check("mémorisée : la 2e vérification ne repaie pas (cache, même adresse en majuscules)", again.source === "cache" && again.verdict === "bloquee" && calls === 1 && cache.has(verifyKey("contact@exemple.fr")));
  check("accept_all : autorisée mais signalée", (await checkRecipient("a@b.fr", fake("accept_all"))).verdict === "risquee");
  check("Hunter indisponible : jamais bloquée faute de vérification", (await checkRecipient("c@d.fr", { ...fake(null), verify: null })).verdict === "non_verifiee");
  const noKey = realRecipientDeps({ from: () => ({}) } as never, new Date(), {});
  check("sans HUNTER_API_KEY : aucun appel possible (tests et environnements sans clé ne dépensent rien)", noKey.verify === null);

  console.log(failures === 0 ? "\nTous les tests délivrabilité passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
