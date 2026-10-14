/**
 * EXPÉRIENCES SUR LES MAILS (Cowork #30) — tirage, immuabilité, injection, mesure.
 *
 * Fausse base en mémoire, faux modèle : aucun appel payant, aucun envoi.
 * `npm run test:experiences`
 */
import type { AskFn } from "../lib/ai/chat";
import type { DerivedFact } from "../lib/emails/derived-facts";
import type { StrategyBrief } from "../lib/emails/strategist";
import { assembleFamily, F3_CTA } from "../lib/emails/quality/families";
import { generateQualityDraft } from "../lib/emails/quality/generate";
import { ctaFor } from "../lib/emails/quality/template";
import { DEMO_LINKS } from "../lib/emails/quality/demo-links";
import { recordAssignment, variantForDraft } from "../lib/experiments/assign";
import { parseVariants, pickVariant, type ExperimentVariant } from "../lib/experiments/model";
import { computeExperimentStats } from "../lib/experiments/stats";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const RDV = "Auriez-vous 15 minutes la semaine prochaine pour en parler ?";
const VIDEO = "Voulez-vous que je vous envoie une vidéo de 2 minutes ?";
const VARIANTS: ExperimentVariant[] = [{ key: "rdv", cta: RDV }, { key: "video", cta: VIDEO }];
const experiment = (over: Record<string, unknown> = {}) => ({ id: "exp-1", user_id: "u1", name: "Appel à l'action", variants: VARIANTS, active: true, started_at: "2026-10-14T08:00:00Z", ...over });

/** Générateur pseudo-aléatoire déterministe (tests reproductibles). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => ((state = (state * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
}

async function main() {
  console.log("\n1. Variantes et tirage équilibré");
  {
    check("deux variantes valides acceptées", parseVariants(VARIANTS)?.length === 2);
    check("refusées : une seule, clés en double, phrase sans « ? »", parseVariants([VARIANTS[0]]) === null && parseVariants([VARIANTS[0], { key: "rdv", cta: VIDEO }]) === null && parseVariants([VARIANTS[0], { key: "b", cta: "Je vous envoie une vidéo." }]) === null);
    const counts: Record<string, number> = {};
    const random = seeded(42);
    let maxGap = 0;
    for (let index = 0; index < 1000; index += 1) {
      const variant = pickVariant(VARIANTS, counts, random);
      counts[variant.key] = (counts[variant.key] ?? 0) + 1;
      maxGap = Math.max(maxGap, Math.abs((counts.rdv ?? 0) - (counts.video ?? 0)));
    }
    check("1 000 tirages : 500 / 500, jamais plus d'un d'écart", counts.rdv === 500 && counts.video === 500 && maxGap <= 1, { counts, maxGap });
    const three = [...VARIANTS, { key: "c", cta: "Un échange de 10 minutes vous irait-il ?" }];
    const tally: Record<string, number> = {};
    for (let index = 0; index < 300; index += 1) {
      const variant = pickVariant(three, tally, random);
      tally[variant.key] = (tally[variant.key] ?? 0) + 1;
    }
    check("trois variantes : 100 / 100 / 100", Object.values(tally).every((count) => count === 100), tally);
    const firsts = new Set(Array.from({ length: 40 }, (_, index) => pickVariant(VARIANTS, {}, seeded(index + 1)).key));
    check("à égalité, le tirage est bien au hasard (les deux sortent)", firsts.size === 2);
  }

  console.log("\n2. Aucune expérience active : rien ne change");
  {
    const none = await variantForDraft(new FakeDb({ mail_experiments: [], mail_experiment_assignments: [] }), { userId: "u1", existingMessageId: null });
    const inactive = await variantForDraft(new FakeDb({ mail_experiments: [experiment({ active: false })], mail_experiment_assignments: [] }), { userId: "u1", existingMessageId: null });
    const missing = await variantForDraft(new FakeDb({}, { strictTables: true }), { userId: "u1", existingMessageId: null });
    check("aucune expérience, expérience inactive, tables absentes : aucune variante", none === null && inactive === null && missing === null, { none, inactive, missing });
    const other = await variantForDraft(new FakeDb({ mail_experiments: [experiment({ user_id: "u2" })], mail_experiment_assignments: [] }), { userId: "u1", existingMessageId: null });
    check("l'expérience d'un autre compte ne s'applique pas", other === null);
  }

  console.log("\n3. Une variante posée ne change jamais");
  {
    const db = new FakeDb({ mail_experiments: [experiment()], mail_experiment_assignments: [] }, { unique: { mail_experiment_assignments: ["message_id"] } });
    const fresh = await variantForDraft(db, { userId: "u1", existingMessageId: null, random: () => 0.9 });
    check("nouveau brouillon, expérience active : une variante tirée", fresh?.variant.key === "video" && fresh.existing === false, fresh);
    check("enregistrée pour le nouveau brouillon", await recordAssignment(db, { messageId: "m1", userId: "u1", draft: fresh }));
    const again = await variantForDraft(db, { userId: "u1", existingMessageId: "m1", random: () => 0 });
    check("régénération du même brouillon : MÊME variante, rien à réenregistrer", again?.variant.key === "video" && again.existing && !(await recordAssignment(db, { messageId: "m1", userId: "u1", draft: again })));
    check("une seconde pose sur le même brouillon est refusée par la base", !(await recordAssignment(db, { messageId: "m1", userId: "u1", draft: { ...fresh!, variant: VARIANTS[0] } })) && db.rows("mail_experiment_assignments").length === 1);
    db.rows("mail_experiments")[0].active = false;
    const stopped = await variantForDraft(db, { userId: "u1", existingMessageId: "m1" });
    check("expérience arrêtée : le brouillon garde sa variante", stopped?.variant.key === "video");
    const legacy = await variantForDraft(db, { userId: "u1", existingMessageId: "m-ancien" });
    db.rows("mail_experiments")[0].active = true;
    const legacyActive = await variantForDraft(db, { userId: "u1", existingMessageId: "m-ancien" });
    check("brouillon né hors expérience : jamais de variante, même expérience active", legacy === null && legacyActive === null);
    const next = await variantForDraft(db, { userId: "u1", existingMessageId: null, random: () => 0.9 });
    check("tirage suivant : la variante la moins servie (rdv)", next?.variant.key === "rdv", next);
  }

  console.log("\n4. Injection : seule la phrase d'appel change");
  {
    const parts = { subject: "Commandes", hook: "Le fait.", proposal: "La proposition." };
    const frame = { greeting: "Bonjour,", demo: DEMO_LINKS.emails };
    const f1 = assembleFamily("F1", parts, { ...frame, cta: ctaFor("p1") });
    const f1Video = assembleFamily("F1", parts, { ...frame, cta: VIDEO, fixedCta: VIDEO });
    check("F1 : même mail, dernière phrase remplacée", f1Video === f1.replace(ctaFor("p1"), VIDEO) && f1Video.endsWith(VIDEO));
    check("F3 sans expérience : demande fixe d'avant", assembleFamily("F3", parts, { ...frame, cta: ctaFor("p1") }).endsWith(F3_CTA));
    check("F3 avec variante : la phrase de la variante", assembleFamily("F3", parts, { ...frame, cta: VIDEO, fixedCta: VIDEO }).endsWith(VIDEO));

    const brief = {
      companyName: "Le Pain de Belledonne",
      angle: { type: "metier", hookFactIds: [], insight: "Quatre fournils et des clients en restauration" },
      pain: { task: "saisie et confirmation des commandes des restaurants", whyThem: [], automationIdea: "commande reçue par mail saisie dans l'outil" },
      rankedFacts: [], avoid: [], cta: "", proofId: null, targetingWarning: null, excludedAngles: [],
    } as unknown as StrategyBrief;
    const fact = { id: "F1", key: "business_locations", label: "Implantations", value: "quatre fournils", source: "Site officiel", hookTier: 1, bodyUsable: true } as unknown as DerivedFact;
    const writer = JSON.stringify({
      subject: "Commandes des restaurants",
      hook: "Avec quatre fournils et des clients en restauration, chaque commande doit être saisie, vérifiée puis confirmée au bon site. C'est souvent là que les délais se perdent.",
      proposal: "J'automatise ce type de tâche pour des PME : la commande reçue par mail est saisie dans votre outil et la confirmation part après votre validation.",
    });
    const prompts: string[] = [];
    const ask: AskFn = async (role, system, user) => {
      prompts.push(`${role}|${system}|${user}`.replace(/\d+ minutes|vidéo de \d+ minutes/g, ""));
      if (role === "writer") return writer;
      return JSON.stringify(Object.fromEntries(["C1", "C2", "C3", "C4", "C5"].map((id) => [id, { ok: true, citation: "ok" }])));
    };
    const base = { brief, facts: [fact], prospectId: "p-belledonne", companyName: "Le Pain de Belledonne", activity: "Boulangerie bio", prospectText: "boulangerie bio", greeting: "Bonjour Monsieur Anquetil,", signature: "Axel Remillat\naxelremillat.com/pme", family: "F1" as const, ask };
    const plain = await generateQualityDraft(base);
    const judged = prompts.filter((prompt) => !prompt.startsWith("writer")).length;
    prompts.length = 0;
    const video = await generateQualityDraft({ ...base, cta: VIDEO });
    const plainBody = "body" in plain ? plain.body : "";
    const videoBody = "body" in video ? video.body : "";
    check("sans variante : la demande habituelle du prospect", plainBody.includes(ctaFor("p-belledonne")), plainBody);
    check("avec variante : la phrase de la variante, le reste du mail identique", videoBody.includes(VIDEO) && videoBody === plainBody.replace(ctaFor("p-belledonne"), VIDEO), videoBody);
    check("le juge est appelé de la même façon pour les deux variantes", prompts.filter((prompt) => !prompt.startsWith("writer")).length === judged, { judged });
    check("« 2 minutes » de la variante n'est pas pris pour un chiffre inventé", "body" in video && !(video.reviewReason ?? "").includes("2"), "body" in video ? video.reviewReason : video);
  }

  console.log("\n5. Mesure par variante");
  {
    const sent = (id: string, prospect: string, at = "2026-10-14T09:00:00Z") => ({ id, prospect_id: prospect, status: "sent", sent_at: at, deleted_at: null });
    const reply = (prospect: string, over: Record<string, unknown> = {}) => ({ prospect_id: prospect, from_email: `contact@${prospect}.fr`, subject: "Re: Votre proposition", body: "Bonjour, oui, appelons-nous.", category: "reponse", received_at: "2026-10-15T09:00:00Z", deleted_at: null, ...over });
    const stats = computeExperimentStats({
      experiments: [experiment()],
      assignments: [
        { message_id: "m1", experiment_id: "exp-1", variant: "rdv" }, { message_id: "m2", experiment_id: "exp-1", variant: "rdv" }, { message_id: "m3", experiment_id: "exp-1", variant: "rdv" },
        { message_id: "m4", experiment_id: "exp-1", variant: "video" }, { message_id: "m5", experiment_id: "exp-1", variant: "video" },
        { message_id: "m6", experiment_id: "exp-1", variant: "video" }, // brouillon pas encore parti
      ],
      messages: [sent("m1", "a"), sent("m2", "b"), sent("m3", "c"), sent("m4", "d"), sent("m5", "e"), { id: "m6", prospect_id: "f", status: "draft", sent_at: null }],
      inbound: [
        reply("a"), reply("a", { body: "Et le tarif ?", category: "question" }), // deux réponses du même prospect : une seule
        reply("b", { body: "Non merci, pas intéressé.", category: "refus" }),
        reply("c", { subject: "Réponse automatique : absent", body: "Je suis absent jusqu'au 20/10." }),
        reply("d", { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)", body: "" }), // rebond : ignoré
        reply("e", { category: "question", body: "Envoyez la vidéo, merci." }), // réponse rattachée par le fil
        reply("e", { received_at: "2026-10-13T09:00:00Z" }), // avant l'envoi : ne compte pas
        reply("zz"), // prospect hors expérience
      ],
    });
    const [rdv, video] = stats[0].variants;
    check("rdv : 3 envoyés, 2 réponses (dont 1 refus), 1 positive, 1 absence", rdv.sent === 3 && rdv.replies === 2 && rdv.positives === 1 && rdv.refusals === 1 && rdv.absences === 1, rdv);
    check("video : 2 envoyés (le brouillon ne compte pas), 1 réponse positive, rebond ignoré", video.sent === 2 && video.replies === 1 && video.positives === 1 && video.refusals === 0 && video.absences === 0, video);
    const later = computeExperimentStats({
      experiments: [experiment()],
      assignments: [{ message_id: "m1", experiment_id: "exp-1", variant: "rdv" }],
      messages: [sent("m1", "a")],
      inbound: [reply("a"), reply("a", { body: "Finalement non, pas pour nous.", category: "refus", received_at: "2026-10-16T09:00:00Z" })],
    });
    check("positive puis refus du même prospect : compté en refus, pas en positive", later[0].variants[0].positives === 0 && later[0].variants[0].refusals === 1, later[0].variants[0]);
  }

  console.log(failures ? `\n${failures} test(s) en échec.` : "\nTous les tests des expériences passent.");
  if (failures) process.exit(1);
}

void main();
