/**
 * RELANCES À 9/10 (Cowork #12) — PAYANT, plafond dur 0,55 € (≈ 0,6 $).
 *
 *   npm run relances:9 -- --etalonnage   8 prospects réels en attente de relance
 *                                        (génériques / nominatives), RIEN n'est écrit ;
 *                                        texte complet + verdict R1–R7 dans
 *                                        evals/relances/etalonnage-<date>.md
 *   npm run relances:9 -- --appliquer    régénère EN PLACE les relances en attente
 *                                        ni validées, ni programmées, ni retouchées
 *   npm run relances:9 -- --appliquer --dry   (lecture seule : la liste visée)
 *
 * Jamais : une relance validée, programmée, retouchée à la main ou écrite hors
 * application ; ESPACE 3000 (hors cible, Axel l'écarte). Rien n'est envoyé ni supprimé.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { db, liveAsk, ownerId, spentSince } from "./quality-live";
import type { Prospect } from "@/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { composeFollowUp } = require("@/lib/outbox/follow-up") as typeof import("@/lib/outbox/follow-up");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isGenericAddress } = require("@/lib/contact-finder/upgrade") as typeof import("@/lib/contact-finder/upgrade");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const relance = require("@/lib/outbox/relance-quality") as typeof import("@/lib/outbox/relance-quality");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ficheOf } = require("@/lib/outbox/follow-up") as typeof import("@/lib/outbox/follow-up");

/** Jeu de référence versionné (notes de Cowork) : jamais ré-étalonné, sert à mesurer l'accord du juge. */
const REFERENCE = "evals/relances/reference-2026-10-09.json";
type ReferenceItem = { company: string; note: number; ready: boolean; subject: string; body: string; generic: boolean };
const referenceItems = (): ReferenceItem[] => (existsSync(REFERENCE) ? (JSON.parse(readFileSync(REFERENCE, "utf8")) as { items: ReferenceItem[] }).items : []);

/** Intro envoyée d'un prospect (corps sans mention stop ni signature). */
async function sentIntro(prospectId: string): Promise<{ subject: string | null; body: string } | null> {
  const { data } = await table.from("messages").select("subject, body").eq("prospect_id", prospectId).eq("type", "intro").eq("status", "sent").order("sent_at", { ascending: true }).limit(1);
  const row = ((data ?? []) as { subject: string | null; body: string }[])[0];
  if (!row) return null;
  const body = row.body.split(/\n\s*Si le sujet ne vous concerne pas/)[0].split(/\nAxel Remillat/)[0].trim();
  return { subject: row.subject, body };
}

/**
 * ACCORD DU JUGE avec les notes de Cowork (prêt = note ≥ 9) : grille complète (code + lecture),
 * et lecture du modèle SEULE (sans les contrôles du code), pour voir s'il tient sans eux.
 */
async function referenceAgreement(userId: string, started: string): Promise<void> {
  const items = referenceItems();
  let full = 0;
  let llmOnly = 0;
  const lines = ["", "## Accord du juge avec les notes de Cowork", "", "| Relance | Note Cowork | Prête (Cowork) | Grille complète | Lecture seule (R2, R5, R7, R8) |", "| --- | --- | --- | --- | --- |"];
  for (const item of items) {
    const { data } = await table.from("prospects").select("*").eq("user_id", userId).eq("company_name", item.company).limit(1);
    const prospect = ((data ?? []) as Prospect[])[0];
    const intro = prospect ? await sentIntro(prospect.id) : null;
    if (!prospect || !intro) {
      console.log(`  ${item.company} : fiche ou intro introuvable`);
      continue;
    }
    const parts = relance.introParts(intro.subject, intro.body);
    const ctx = { intro: parts, generic: item.generic, seed: item.company };
    // Une seule lecture du modèle (vote à 3) ; la grille complète y ajoute les contrôles du code.
    const semantic = await relance.readRelance(liveAsk(prospect.id), { body: item.body, introBody: intro.body, fiche: ficheOf(prospect) }, "relance:reference", 3);
    const verdict = semantic ? relance.relanceVerdictOf([...relance.relanceCodeChecks(item.subject, item.body, ctx), ...semantic]) : null;
    const llmReady = Boolean(semantic && semantic.every((criterion) => criterion.ok));
    const fullReady = Boolean(verdict?.ready);
    if (fullReady === item.ready) full += 1;
    if (llmReady === item.ready) llmOnly += 1;
    const failed = (verdict?.items ?? []).filter((criterion) => !criterion.ok).map((criterion) => criterion.id).join(", ");
    const llmFailed = (semantic ?? []).filter((criterion) => !criterion.ok).map((criterion) => `${criterion.id} : ${criterion.citation}`).join(" ; ");
    lines.push(`| ${item.company} | ${item.note} | ${item.ready ? "oui" : "non"} | ${fullReady ? "prête" : `non (${failed})`} | ${llmReady ? "prête" : `non — ${llmFailed}`} |`);
    console.log(`  ${item.company} (${item.note}) : grille ${fullReady ? "prête" : `non (${failed})`} · lecture seule ${llmReady ? "prête" : `non — ${llmFailed}`}`);
    if ((await spentSince(userId, started)) > BUDGET_EUR) break;
  }
  lines.push("", `Accord, grille complète : ${full}/${items.length} · lecture du modèle seule : ${llmOnly}/${items.length}`);
  writeFileSync(REFERENCE.replace(".json", "-accord.md"), `# Accord du juge — jeu de référence de Cowork (${started.slice(0, 10)})\n${lines.join("\n")}\n`);
  console.log(`\nAccord, grille complète : ${full}/${items.length} · lecture seule : ${llmOnly}/${items.length}`);
}

const BUDGET_EUR = 0.55;
/** Hors cible (Axel l'écarte) ou déjà validées : jamais touchées, quoi qu'il arrive. */
const NEVER = /^(espace 3000|gatine|nordisk|caste ing|thibault bergeron|carea sanitaire|fonderie de la bruche)/i;
const table = db as never as { from: (t: string) => any };
type Draft = { id: string; prospect_id: string; type: "relance_1" | "relance_2"; subject: string | null; validated_at: string | null; scheduled_at: string | null; send_status: string | null; edited_by_hand: boolean | null; origin: string | null };

async function pendingRelances(userId: string): Promise<{ draft: Draft; prospect: Prospect }[]> {
  const { data } = await table
    .from("messages")
    .select("id, prospect_id, type, subject, validated_at, scheduled_at, send_status, edited_by_hand, origin")
    .eq("user_id", userId)
    .in("type", ["relance_1", "relance_2"])
    .eq("status", "draft")
    .is("deleted_at", null);
  const drafts = ((data ?? []) as Draft[]).filter(
    (draft) => !draft.validated_at && !draft.scheduled_at && (!draft.send_status || draft.send_status === "draft") && !draft.edited_by_hand && !draft.origin,
  );
  const out: { draft: Draft; prospect: Prospect }[] = [];
  for (const draft of drafts) {
    const { data: prospect } = await table.from("prospects").select("*").eq("id", draft.prospect_id).maybeSingle();
    if (prospect && !NEVER.test((prospect as Prospect).company_name)) out.push({ draft, prospect: prospect as Prospect });
  }
  return out;
}

const verdictLine = (items: { id: string; ok: boolean; citation: string }[] | undefined) =>
  (items ?? []).map((item) => `${item.id} ${item.ok ? "OUI" : "NON"}${item.ok ? "" : ` (${item.citation})`}`).join(" · ");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const apply = process.argv.includes("--appliquer");
  if (process.argv.includes("--reference")) {
    await referenceAgreement(userId, started);
    console.log(`coût ${(await spentSince(userId, started)).toFixed(4)} €`);
    return;
  }
  const dry = process.argv.includes("--dry");
  const pending = await pendingRelances(userId);
  // Un lot par exécution : chaque relance prend un verbe et une question différents des précédentes.
  const lot = relance.newLot();

  if (apply) {
    console.log(`${pending.length} relance(s) en attente à régénérer : ${pending.map((item) => item.prospect.company_name).join(", ")}${dry ? " (lecture seule)" : ""}`);
    if (dry) return;
    let ready = 0;
    let review = 0;
    for (const { draft, prospect } of pending) {
      if ((await spentSince(userId, started)) > BUDGET_EUR) {
        console.log("Plafond de dépense atteint : arrêt.");
        break;
      }
      const composed = await composeFollowUp(table as never, { userId, prospect, type: draft.type, ask: liveAsk(prospect.id), lot });
      if (!composed.ok) {
        console.log(`  ${prospect.company_name} : ${composed.error}`);
        continue;
      }
      const { subject, body, quality_score, quality_reason, ready: ok } = composed.draft;
      // Mise à jour EN PLACE (même brouillon, même fil) : rien n'est supprimé.
      await table.from("messages").update({ subject, body, quality_score, quality_reason }).eq("id", draft.id).is("validated_at", null).eq("status", "draft");
      if (ok) ready += 1;
      else review += 1;
      console.log(`  ${prospect.company_name} : ${ok ? "PRÊTE" : `À revoir — ${quality_reason}`}`);
    }
    console.log(`\nPrêtes : ${ready} · à revoir : ${review} · coût ${(await spentSince(userId, started)).toFixed(4)} €`);
    return;
  }

  // Étalonnage : 8 prospects réels (relances en attente d'abord, puis autres contactés), génériques / nominatives.
  // Jamais les prospects du jeu de référence : l'étalonnage porte sur des NOUVEAUX prospects.
  const known = new Set([...referenceItems().map((item) => item.company), ...(process.argv.find((arg) => arg.startsWith("--exclure="))?.slice(10).split("|") ?? [])]);
  const candidates: Prospect[] = pending.map((item) => item.prospect).filter((prospect) => !known.has(prospect.company_name));
  if (candidates.length < 12) {
    const { data } = await table.from("prospects").select("*").eq("user_id", userId).eq("status", "contacte").limit(80);
    for (const prospect of (data ?? []) as Prospect[]) if (!candidates.some((item) => item.id === prospect.id) && !NEVER.test(prospect.company_name) && !known.has(prospect.company_name)) candidates.push(prospect);
  }
  // --prospects=A|B|… : rejouer ces fiches d'abord (même jeu que l'étalonnage précédent), puis compléter jusqu'à 8.
  const wanted = process.argv.find((arg) => arg.startsWith("--prospects="))?.slice(12).split("|").filter(Boolean) ?? [];
  if (wanted.length) {
    const { data } = await table.from("prospects").select("*").eq("user_id", userId).in("company_name", wanted);
    const chosen = ((data ?? []) as Prospect[]).sort((a, b) => wanted.indexOf(a.company_name) - wanted.indexOf(b.company_name));
    candidates.splice(0, candidates.length, ...chosen, ...candidates.filter((prospect) => !wanted.includes(prospect.company_name)));
  }
  const generic = candidates.filter((prospect) => isGenericAddress({ email: prospect.email, email_type: prospect.email_type ?? null }));
  const nominative = candidates.filter((prospect) => !generic.includes(prospect));
  const lines: string[] = [`# Étalonnage des relances — ${started.slice(0, 10)}`, "", "8 relances générées sur des prospects réels (hors jeu de référence), SANS écriture en base. Verdict R1–R10 du générateur ; note d'Axel / Cowork à ajouter.", ""];
  let done = 0;
  // Alternance générique / nominative, puis le reste de la liste la plus longue.
  const queue: (readonly ["générique" | "nominative", Prospect])[] = [];
  const kindOf = (prospect: Prospect) => (generic.includes(prospect) ? "générique" : "nominative") as "générique" | "nominative";
  if (wanted.length) {
    // Les fiches demandées dans l'ordre, puis les autres (alternance générique / nominative).
    for (const prospect of candidates) queue.push([kindOf(prospect), prospect]);
  } else {
    for (let index = 0; index < Math.max(generic.length, nominative.length); index += 1) {
      if (generic[index]) queue.push(["générique", generic[index]]);
      if (nominative[index]) queue.push(["nominative", nominative[index]]);
    }
  }
  for (const [kind, prospect] of queue) {
    if (done >= 8) break;
    if ((await spentSince(userId, started)) > BUDGET_EUR) {
      lines.push("Plafond de dépense atteint : arrêt.");
      break;
    }
    const composed = await composeFollowUp(table as never, { userId, prospect, type: "relance_1", ask: liveAsk(prospect.id), lot });
    if (!composed.ok) {
      console.log(`  ${prospect.company_name} : ${composed.error}`);
      continue;
    }
    done += 1;
    const draft = composed.draft;
    lines.push(`## ${done}. ${prospect.company_name} — adresse ${kind}`, "", `Objet : ${draft.subject}`, "", "```", draft.body, "```", "", `Verdict : ${draft.ready ? "PRÊTE" : "À REVOIR"} · ${draft.quality_score ?? "?"}/10${draft.quality_reason ? ` · ${draft.quality_reason}` : ""}`, "", `Grille : ${verdictLine(draft.checklist)}`, "", "Note Axel / Cowork : …", "");
    console.log(`${done}. ${prospect.company_name} (${kind}) : ${draft.ready ? "PRÊTE" : `À revoir — ${draft.quality_reason}`}`);
  }
  lines.push(`Coût : ${(await spentSince(userId, started)).toFixed(4)} €`);
  mkdirSync("evals/relances", { recursive: true });
  const version = process.argv.find((arg) => arg.startsWith("--version="))?.slice(10) ?? "v2";
  const file = `evals/relances/etalonnage-${started.slice(0, 10)}-${version}.md`;
  writeFileSync(file, `${lines.join("\n")}\n`);
  console.log(`\n${file} · coût ${(await spentSince(userId, started)).toFixed(4)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
