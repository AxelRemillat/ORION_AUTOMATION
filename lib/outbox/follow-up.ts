import { completeText } from "@/lib/openai";
import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import { applyGreeting, cleanDraft, withOptOut } from "@/lib/mail-preflight";
import { stripSignature } from "@/app/api/emails/generate/pipeline";
import { loadOffer } from "@/lib/offer/read";
import { signatureFor } from "@/lib/offer/model";
import type { Db } from "@/lib/trash/scope";
import { followUpBlock, followUpRefusal } from "./follow-up-policy";
import { replySinceLastSend } from "./relances";
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
 * mails épars. Ce n'était pas le cas : la relance partait sans fil.
 */

export type FollowUpType = Extract<MessageType, "relance_1" | "relance_2">;
export type FollowUpResult = { ok: true; messageId: string } | { ok: false; error: string };

const SYSTEM =
  "Tu écris des relances commerciales en français pour un freelance qui automatise les tâches des PME avec l'IA. " +
  "Ton direct, poli, 90 mots maximum, aucune formule pompeuse, une seule question claire. " +
  "Réponds uniquement par le corps du mail, sans objet ni balise.";

export function fallbackFollowUp(company: string, type: FollowUpType): string {
  const first = type === "relance_1";
  return [
    "Bonjour,",
    "",
    first
      ? `Je me permets de revenir vers vous suite à mon message concernant ${company}.`
      : `Dernier message de ma part au sujet de ${company} — je n'insisterai pas davantage.`,
    "",
    first
      ? "Est-ce un sujet sur lequel vous souhaitez qu'on échange 15 minutes ?"
      : "Si le moment n'est pas le bon, dites-le moi simplement et je reviendrai plus tard.",
  ].join("\n");
}

export async function draftFollowUp(
  db: Db,
  input: { userId: string; prospect: Prospect; type: FollowUpType; complete?: typeof completeText },
): Promise<FollowUpResult> {
  const { prospect, type } = input;
  // Jamais de relance pour un prospect opposé, « ne plus contacter », perdu ou
  // qui a répondu — même règle que l'envoi (lib/outbox/follow-up-policy.ts).
  const replied = await replySinceLastSend(db, input.userId, prospect.id).catch(() => null);
  const blocked = followUpBlock(prospect, { replied: Boolean(replied) });
  if (blocked) return { ok: false, error: followUpRefusal(blocked) };
  const { data: previous } = await db
    .from("messages")
    .select("type, subject, body, sent_at, thread_id, gmail_message_id")
    .eq("prospect_id", prospect.id)
    .eq("status", "sent")
    .order("sent_at", { ascending: true });
  const sent = (previous ?? []) as { type: string; subject: string | null; body: string; thread_id: string | null; gmail_message_id: string | null }[];
  const intro = sent.find((message) => message.type === "intro");
  const last = sent[sent.length - 1];

  const complete = input.complete ?? completeText;
  let body: string;
  try {
    body = await complete({
      system: SYSTEM,
      user: [
        `Entreprise : ${prospect.company_name}`,
        prospect.sector ? `Secteur : ${prospect.sector}` : "",
        prospect.pain_point ? `Problème identifié : ${prospect.pain_point}` : "",
        intro ? `Message d'intro déjà envoyé :\n${intro.body}` : "",
        `Type de relance : ${MESSAGE_TYPE_LABELS[type]}`,
      ]
        .filter(Boolean)
        .join("\n"),
      temperature: 0.6,
      operation: "relance",
      prospectId: prospect.id,
    });
  } catch {
    body = "";
  }
  if (!body.trim()) body = fallbackFollowUp(prospect.company_name, type);

  // Même nettoyage que l'intro : une seule salutation, pas de ligne « Objet »,
  // la mention d'opposition et la signature du compte.
  const { offer } = await loadOffer(db, input.userId);
  const signature = signatureFor(offer);
  const clean = cleanDraft({ subject: intro?.subject ? `Re: ${intro.subject.replace(/^re\s*:\s*/i, "")}` : `${prospect.company_name} — suite`, body });
  const finalBody = withOptOut(`${applyGreeting(stripSignature(clean.body), "Bonjour,")}\n\n${signature}`, signature);

  const { data, error } = await db
    .from("messages")
    .insert({
      prospect_id: prospect.id,
      user_id: input.userId,
      type,
      subject: clean.subject,
      body: finalBody,
      status: "draft",
      sent_at: null,
      thread_id: last?.thread_id ?? null,
      reply_to_gmail_message_id: last?.gmail_message_id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Relance non enregistrée." };
  return { ok: true, messageId: (data as { id: string }).id };
}
