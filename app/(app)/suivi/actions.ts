"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { activeProspects } from "@/lib/trash/scope";
import { completeText } from "@/lib/openai";
import { MESSAGE_TYPE_LABELS } from "@/lib/constants";
import type { MessageType, ProspectStatus } from "@/types";

/** Résultat uniforme : les composants clients en font un toast. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function refresh(prospectId?: string) {
  revalidatePath("/suivi");
  if (prospectId) revalidatePath(`/suivi/${prospectId}`);
  revalidatePath("/stats");
}

/** Change le statut d'un prospect (répondu, en discussion, gagné, perdu…). */
export async function setProspectStatus(
  prospectId: string,
  status: ProspectStatus,
): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase
    .from("prospects")
    .update({ status })
    .eq("id", prospectId)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };

  // Un prospect sorti du cycle n'a plus de relance à faire.
  if (status === "gagne" || status === "perdu" || status === "en_discussion") {
    await supabase
      .from("reminders")
      .update({ done: true })
      .eq("prospect_id", prospectId)
      .eq("done", false);
  }

  refresh(prospectId);
  return { ok: true };
}

/**
 * Montant estimé d'une affaire en cours, saisi par l'utilisateur.
 *
 * C'est la SEULE source de la « valeur du pipeline » : l'app ne devine plus
 * aucun montant. Le montant vit sur un deal `ouvert` du prospect, cree a la
 * volee s'il n'existe pas encore. `null` efface l'estimation sans supprimer
 * le deal (l'historique de l'affaire reste).
 */
export async function setDealEstimate(
  prospectId: string,
  amountEur: number | null,
): Promise<ActionResult> {
  if (amountEur !== null && (!Number.isFinite(amountEur) || amountEur < 0)) {
    return { ok: false, error: "Le montant doit être un nombre positif." };
  }

  const supabase = createClient();

  // La RLS restreint deja au proprietaire : une ligne trouvee est la sienne.
  const { data: existing, error: readError } = await supabase
    .from("deals")
    .select("id")
    .eq("prospect_id", prospectId)
    .eq("status", "ouvert")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  if (existing) {
    const { error } = await supabase
      .from("deals")
      .update({ amount_eur: amountEur })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    // Rien a creer si l'utilisateur efface un montant qui n'existait pas.
    if (amountEur === null) return { ok: true };
    const { error } = await supabase
      .from("deals")
      .insert({ prospect_id: prospectId, amount_eur: amountEur, status: "ouvert" });
    if (error) return { ok: false, error: error.message };
  }

  refresh(prospectId);
  revalidatePath("/cockpit");
  return { ok: true, message: amountEur === null ? "Estimation effacée." : "Estimation enregistrée." };
}

/** Enregistre un contrat signé et bascule le prospect en « gagné ». */
export async function createDeal(
  prospectId: string,
  amountEur: number,
  signedAt: string,
): Promise<ActionResult> {
  if (!Number.isFinite(amountEur) || amountEur < 0) {
    return { ok: false, error: "Le montant doit être un nombre positif." };
  }
  if (Number.isNaN(Date.parse(signedAt))) {
    return { ok: false, error: "La date de signature est invalide." };
  }

  const supabase = createClient();
  const { error } = await supabase.from("deals").insert({
    prospect_id: prospectId,
    amount_eur: amountEur,
    status: "gagne",
    signed_at: new Date(signedAt).toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  return setProspectStatus(prospectId, "gagne");
}

/** Solde (ou rouvre) une relance. */
export async function setReminderDone(reminderId: string, done: boolean): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("reminders").update({ done }).eq("id", reminderId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Relance de secours si OpenAI n'est pas configuré ou indisponible. */
function fallbackFollowUp(company: string, type: MessageType) {
  const first = type === "relance_1";
  return [
    `Bonjour,`,
    ``,
    first
      ? `Je me permets de revenir vers vous suite à mon message concernant ${company}.`
      : `Dernier message de ma part au sujet de ${company} — je n'insisterai pas davantage.`,
    ``,
    first
      ? `Est-ce un sujet sur lequel vous souhaitez qu'on échange 15 minutes ?`
      : `Si le moment n'est pas le bon, dites-le moi simplement et je reviendrai plus tard.`,
    ``,
    `Bien à vous,`,
    `Axel`,
  ].join("\n");
}

/**
 * Génère puis enregistre une relance en brouillon (elle s'envoie ensuite via
 * le même flux que le message d'intro).
 */
export async function generateFollowUp(
  prospectId: string,
  type: Extract<MessageType, "relance_1" | "relance_2">,
): Promise<ActionResult> {
  const supabase = createClient();

  const { data: prospect, error: prospectError } = await activeProspects(supabase)
    .eq("id", prospectId)
    .maybeSingle();
  if (prospectError) return { ok: false, error: prospectError.message };
  if (!prospect) return { ok: false, error: "Prospect introuvable." };

  const { data: previous } = await supabase
    .from("messages")
    .select("type, subject, body, sent_at")
    .eq("prospect_id", prospectId)
    .eq("status", "sent")
    .order("created_at", { ascending: true });

  const intro = previous?.find((message) => message.type === "intro");

  let body: string;
  try {
    body = await completeText({
      system:
        "Tu écris des relances commerciales en français pour un freelance data/IA. " +
        "Ton direct, poli, 90 mots maximum, aucune formule pompeuse, une seule question claire. " +
        "Réponds uniquement par le corps du mail, sans objet ni balise.",
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
    });
  } catch {
    body = fallbackFollowUp(prospect.company_name, type);
  }
  if (!body.trim()) body = fallbackFollowUp(prospect.company_name, type);

  const subject = intro?.subject ? `Re: ${intro.subject}` : `${prospect.company_name} — suite`;
  const { error } = await supabase
    .from("messages")
    .insert({ prospect_id: prospectId, type, subject, body, status: "draft", sent_at: null });
  if (error) return { ok: false, error: error.message };

  refresh(prospectId);
  return { ok: true, message: `${MESSAGE_TYPE_LABELS[type]} enregistrée en brouillon.` };
}
