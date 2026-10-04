/**
 * RELANCE RÉELLE de la complétion automatique sur des fiches nommées
 * (Cowork, 05/10/2026). PAYANT, plafonné : Linkup ≤ 10 recherches, OpenAI ≤ 0,10 €.
 *
 *   npm run complete:fiches -- "%C.T.A.%" "%SAIREM%" …
 *
 * Pour chaque fiche : une tentative de complétion (site → email → MX → profil
 * → « Non joignable » à la 3e tentative vaine), puis, si site et email sont
 * là, le brouillon avec les règles qualité (historique conservé). Aucun envoi,
 * aucune suppression.
 */
import { db, ownerId, prepareMail, spentSince } from "./quality-live";
import { completeOne } from "@/lib/today/complete";
import { liveCompletionDeps } from "@/lib/today/complete-live";
import { exclusionOf } from "@/lib/today/items";
import { replaceDraft } from "@/lib/emails/quality/versions";
import type { Prospect, SignalCandidateRow } from "@/types";

const LINKUP_MAX = 10;
const OPENAI_MAX_EUR = 0.1;

async function linkupSince(since: string): Promise<number> {
  const { data } = await db.from("api_usage").select("units").eq("service", "linkup").gte("created_at", since);
  return (data ?? []).reduce((total, row) => total + (Number((row as { units: number }).units) || 0), 0);
}

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const patterns = process.argv.slice(2);
  const runId = `relance-${started.slice(0, 10)}`;
  const deps = liveCompletionDeps(db as never, userId, runId);

  for (const pattern of patterns) {
    if ((await linkupSince(started)) >= LINKUP_MAX || (await spentSince(userId, started)) >= OPENAI_MAX_EUR) {
      console.log(`${pattern} | arrêt : plafond de la relance atteint`);
      continue;
    }
    const { data } = await db.from("prospects").select("*").is("deleted_at", null).ilike("company_name", pattern).limit(1);
    const prospect = (data?.[0] as Prospect | undefined) ?? null;
    if (!prospect) {
      console.log(`${pattern} | introuvable`);
      continue;
    }
    const excluded = exclusionOf(prospect);
    if (excluded) {
      console.log(`${prospect.company_name} | exclue : ${excluded}`);
      continue;
    }
    const { data: rows } = await db.from("signal_candidates").select("*").eq("prospect_id", prospect.id).order("created_at", { ascending: false }).limit(1);
    const row = (rows?.[0] as SignalCandidateRow | undefined) ?? null;
    if (!row) {
      console.log(`${prospect.company_name} | aucune fiche d'entonnoir`);
      continue;
    }
    const outcome = await completeOne(db as never, row, { deps, runId });
    const { data: fresh } = await db.from("prospects").select("*").eq("id", prospect.id).maybeSingle();
    const now = fresh as Prospect;
    const site = now.website ?? "—";
    if (outcome.unreachable) {
      console.log(`${now.company_name} | site : ${site} | email : — | NON JOIGNABLE (${(now.key_figures as { unreachable?: { reason?: string } })?.unreachable?.reason ?? ""})`);
      continue;
    }
    if (!now.email || !now.website) {
      console.log(`${now.company_name} | site : ${site} | email : ${now.email ?? "—"} | reste à compléter`);
      continue;
    }
    const prepared = await prepareMail(now, userId, { readSite: true, persist: true });
    const result = prepared.outcome;
    if ("error" in result) {
      console.log(`${now.company_name} | site : ${site} | email : ${now.email} | erreur de rédaction : ${result.error}`);
      continue;
    }
    if ("blocked" in result) {
      await db.from("prospects").update({ key_figures: { ...(now.key_figures ?? {}), mail_review: { reason: result.blocked, at: new Date().toISOString() } } }).eq("id", now.id);
      console.log(`${now.company_name} | site : ${site} | email : ${now.email} | À revoir : ${result.blocked}`);
      continue;
    }
    const quality = { quality_score: result.score, quality_reason: result.needsReview ? result.reviewReason : null };
    const { data: drafts } = await db.from("messages").select("id").eq("prospect_id", now.id).eq("type", "intro").eq("status", "draft").is("deleted_at", null).limit(1);
    const existing = (drafts?.[0] as { id: string } | undefined)?.id;
    if (existing) {
      await replaceDraft({ db: db as never, userId }, existing, { subject: result.subject, body: result.body, ...quality }, { auto: true, reason: "complétion automatique (05/10/2026)" });
    } else {
      await db.from("messages").insert({ prospect_id: now.id, user_id: userId, type: "intro", status: "draft", subject: result.subject, body: result.body, ...quality });
    }
    console.log(`${now.company_name} | site : ${site} | email : ${now.email} | mail ${result.needsReview ? "À REVOIR" : "prêt"} ${result.score ?? "?"}/10`);
    console.log(`    Objet : ${result.subject}\n${result.body.split("\n\nSi le sujet")[0].replace(/^/gm, "    ")}`);
  }
  console.log(`\nLinkup : ${await linkupSince(started)} recherche(s) · OpenAI : ${(await spentSince(userId, started)).toFixed(3)} €`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
