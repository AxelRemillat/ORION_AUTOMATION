import { chatJson, type AskFn } from "@/lib/ai/chat";
import { getOpenAI } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { withOptOut } from "@/lib/mail-preflight";
import { OPT_OUT_SENTENCE } from "@/lib/mail-preflight/opt-out";
import { loadOffer } from "@/lib/offer/read";
import { signatureFor } from "@/lib/offer/model";
import { keyFactsOf } from "@/lib/emails/quality/facts-gate";
import { isGenericAddress } from "@/lib/contact-finder/upgrade";
import type { Db } from "@/lib/trash/scope";
import { followUpBlock, followUpRefusal } from "./follow-up-policy";
import { offTargetReason } from "@/lib/funnel/off-target";
import { replySinceLastSend } from "./relances";
import { introParts, writeRelance, type RelanceFiche, type RelanceLot } from "./relance-quality";
import { chooseRelanceMode, relanceGreeting, writeShortRelance, type RelanceMode } from "./relance-short";
import { withoutSignature } from "@/lib/mail-preflight/words";
import type { CivilityCache } from "@/lib/emails/quality/greeting";
import type { MessageType, Prospect } from "@/types";

/**
 * Brouillon de relance, DANS LE FIL de l'envoi précédent.
 *
 * Utilisé par la fiche (bouton « Générer la relance ») et par la préparation
 * automatique de « Aujourd'hui ». Le client Supabase est injecté : la fiche
 * passe sa session, le job sa clé de service.
 *
 * « Même fil » : la relance reprend le `thread_id` de l'envoi précédent et y
 * répond (`reply_to_gmail_message_id`). Le workflow d'envoi la poste alors
 * dans la conversation Gmail d'origine — un prospect voit un fil, pas trois
 * mails épars.
 *
 * Rédaction (Cowork #12, 9/10 demandé par Axel) : grille R1–R7
 * (lib/outbox/relance-quality.ts). Une relance qui n'est pas « prête » après
 * une réécriture ciblée reste en brouillon « À revoir », avec le critère en cause.
 */

export type FollowUpType = Extract<MessageType, "relance_1" | "relance_2">;
export type FollowUpResult = { ok: true; messageId: string; ready: boolean } | { ok: false; error: string };

/** Texte de secours quand la rédaction est indisponible : toujours « À revoir ». */
export function fallbackFollowUp(company: string, type: FollowUpType): string {
  const first = type === "relance_1";
  return [
    "Bonjour,",
    "",
    first ? `Un mot pour savoir si le sujet de mon précédent message concerne ${company} en ce moment.` : `Dernier message de ma part au sujet de ${company}.`,
    "",
    "Dites-moi simplement si c'est un sujet chez vous.",
  ].join("\n");
}

/** Corps de l'intro sans la mention d'opposition (ni ses variantes « STOP »). */
const stripOptOut = (body: string) =>
  body
    .split(OPT_OUT_SENTENCE)
    .join("")
    .split("\n")
    .filter((line) => !/(simple\s+[«"]?\s*stop|r[ée]pondez\s+[«"]?\s*stop|ne vous relancerai pas|ne plus recevoir)/i.test(line))
    .join("\n");

/** Ce que la relance peut citer : faits sourcés, profil métier vérifié, signaux datés. */
export function ficheOf(prospect: Prospect): RelanceFiche {
  const figures = (prospect.key_figures ?? null) as Record<string, unknown> | null;
  const keyFacts = keyFactsOf(figures) ?? [];
  const facts = keyFacts.map((fact) => fact.text);
  const profile = (prospect.business_profile ?? null) as { offer?: string; demandChannels?: string[]; services?: { name: string }[]; counts?: { label: string; count: number }[] } | null;
  if (profile?.demandChannels?.length) facts.push(`Canaux de demande : ${profile.demandChannels.join(", ")}`);
  if (profile?.services?.length) facts.push(`Services : ${profile.services.map((service) => service.name).join(", ")}`);
  if (profile?.counts?.length) facts.push(...profile.counts.map((count) => `${count.count} ${count.label}`));
  const signals = (prospect.signals ?? []).map((signal) => `${signal.label}${signal.date ? ` (${signal.date})` : ""}`);
  return {
    companyName: prospect.company_name,
    sourcedFacts: keyFacts.map((fact) => ({ text: fact.text, distinctiveness: fact.distinctiveness, source_url: fact.source_url, process_hint: fact.process_hint })),
    facts: facts.slice(0, 12),
    signals: signals.slice(0, 8),
    activity: profile?.offer ?? prospect.sector ?? null,
  };
}

/** Appel du modèle pour les relances, compté dans l'usage (opération « relance:* »). */
export function relanceAsk(prospectId?: string): AskFn {
  return (role, system, user, temperature, operation) =>
    chatJson({
      client: getOpenAI(),
      role,
      system,
      user,
      temperature,
      operation,
      onUsage: (usage) =>
        recordOpenAiUsage({ model: usage.model, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, operation: usage.operation, prospectId: prospectId ?? null }),
    });
}

export interface ComposedFollowUp {
  subject: string;
  body: string;
  quality_score: number | null;
  quality_reason: string | null;
  thread_id: string | null;
  reply_to_gmail_message_id: string | null;
  ready: boolean;
  /** Mode choisi par le code (Cowork #16) : A relance enrichie, B relance courte — jamais écrit en base. */
  mode?: RelanceMode;
  modeReason?: string;
  /** Grille détaillée (rapports, étalonnage) — jamais écrite en base. */
  checklist?: { id: string; ok: boolean; citation: string }[];
}

/**
 * Rédige la relance (sans rien écrire en base) : contrôle d'opposition, intro
 * envoyée, grille R1–R7, signature et mention d'opposition.
 */
export async function composeFollowUp(
  db: Db,
  input: { userId: string; prospect: Prospect; type: FollowUpType; ask?: AskFn; /** Lot en cours : variété des verbes et des questions (Cowork #15). */ lot?: RelanceLot; /** Date de rédaction (« de la semaine dernière ») : maintenant par défaut. */ now?: Date },
): Promise<{ ok: true; draft: ComposedFollowUp } | { ok: false; error: string }> {
  const { prospect, type } = input;
  // Jamais de relance pour un prospect opposé, « ne plus contacter », perdu ou
  // qui a répondu — même règle que l'envoi (lib/outbox/follow-up-policy.ts).
  const replied = await replySinceLastSend(db, input.userId, prospect.id).catch(() => null);
  const blocked = followUpBlock(prospect, { replied: Boolean(replied) });
  if (blocked) return { ok: false, error: followUpRefusal(blocked) };
  // Hors cible (filiale de groupe, concurrent, signal pour un client…) : aucune relance (Cowork #14, MAVIFLEX).
  const offTarget = offTargetReason(prospect);
  if (offTarget) return { ok: false, error: followUpRefusal(`hors cible : ${offTarget}`) };
  const { data: previous } = await db
    .from("messages")
    .select("id, type, subject, body, sent_at, thread_id, gmail_message_id")
    .eq("prospect_id", prospect.id)
    .eq("status", "sent")
    .order("sent_at", { ascending: true });
  const sent = (previous ?? []) as { id?: string; type: string; subject: string | null; body: string; sent_at?: string | null; thread_id: string | null; gmail_message_id: string | null }[];
  const intro = sent.find((message) => message.type === "intro");
  const last = sent[sent.length - 1];
  if (!intro) return { ok: false, error: "Aucune intro envoyée : pas de relance possible." };

  const { offer } = await loadOffer(db, input.userId);
  const signature = signatureFor(offer);
  // L'intro envoyée porte la mention d'opposition et la signature : la relance ne lit que son corps.
  const introBody = stripOptOut(withoutSignature(intro.body, signature)).trim();
  // Famille de l'intro (message_variants) : elle donne le &v d'un lien d'intro antérieur aux familles.
  const { data: variant } = intro.id ? await db.from("message_variants").select("family").eq("message_id", intro.id).maybeSingle() : { data: null };
  const fiche = ficheOf(prospect);
  const generic = isGenericAddress({ email: prospect.email, email_type: prospect.email_type ?? null });
  const introFamily = (variant as { family?: string | null } | null)?.family ?? null;
  // Adresse nominative au nom connu : « Bonjour Monsieur X, » même si l'intro disait « Bonjour, » (Cowork #18, TECHNAMM).
  const greeting = relanceGreeting({
    introGreeting: introParts(intro.subject, introBody, introFamily).greeting,
    generic,
    email: prospect.email,
    contactName: prospect.contact_name ?? null,
    civilities: ((prospect.key_figures ?? {}) as { civilites?: CivilityCache }).civilites,
  });
  // Deux modes (Cowork #16) : relance enrichie seulement si un fait sourcé distinctif porte sur le processus de l'intro.
  const choice = chooseRelanceMode(fiche, intro.subject, introBody);
  const ask = input.ask ?? relanceAsk(prospect.id);
  const written = choice.mode === "B"
    ? await writeShortRelance(ask, { introSubject: intro.subject, introBody, generic, fiche, introFamily, introSentAt: intro.sent_at ?? null, now: input.now, lot: input.lot, greeting }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "rédaction impossible" }))
    : await writeRelance(ask, {
    anchor: choice.anchor,
    greeting,
    introFamily,
    lot: input.lot,
    introSubject: intro.subject,
    introBody,
    generic,
    fiche,
    type,
  }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "rédaction impossible" }));

  const base = { thread_id: last?.thread_id ?? null, reply_to_gmail_message_id: last?.gmail_message_id ?? null };
  if ("error" in written) {
    const subject = intro.subject ? `Re: ${intro.subject.replace(/^re\s*:\s*/i, "")}` : `${prospect.company_name} — suite`;
    return { ok: true, draft: { ...base, subject, body: withOptOut(`${fallbackFollowUp(prospect.company_name, type)}\n\n${signature}`, signature), quality_score: null, quality_reason: `Rédaction indisponible : à réécrire (${written.error}).`, ready: false } };
  }
  return {
    ok: true,
    draft: {
      ...base,
      subject: written.subject,
      body: withOptOut(`${written.body}\n\n${signature}`, signature),
      quality_score: written.verdict?.score ?? null,
      quality_reason: written.ready ? null : written.reason,
      ready: written.ready,
      checklist: written.verdict?.items,
      mode: choice.mode,
      modeReason: choice.reason,
    },
  };
}

export async function draftFollowUp(
  db: Db,
  input: { userId: string; prospect: Prospect; type: FollowUpType; ask?: AskFn; lot?: RelanceLot; /** @deprecated remplacé par `ask` */ complete?: unknown },
): Promise<FollowUpResult> {
  const composed = await composeFollowUp(db, input);
  if (!composed.ok) return composed;
  // `ready` et `checklist` ne sont pas des colonnes : seul le reste part en base.
  const { ready, checklist: _checklist, mode: _mode, modeReason: _modeReason, ...draft } = composed.draft;
  void _checklist;
  void _mode;
  void _modeReason;
  const { data, error } = await db
    .from("messages")
    .insert({
      prospect_id: input.prospect.id,
      user_id: input.userId,
      type: input.type,
      ...draft,
      status: "draft",
      sent_at: null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Relance non enregistrée." };
  return { ok: true, messageId: (data as { id: string }).id, ready };
}
