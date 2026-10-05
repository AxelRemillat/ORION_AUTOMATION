import { isOpportunityStatus, isPlatform, REPLIED_STATUSES, type OpportunityStatus, type Platform } from "./types";

/**
 * Validation des saisies (création, mise à jour). Code pur : la route ne fait
 * qu'appeler ces fonctions et écrire le résultat.
 */

export interface NewOpportunity {
  platform: Platform;
  url: string | null;
  title: string;
  body: string;
  budget: string | null;
  deadline: string | null;
}

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export function parseNewOpportunity(raw: Record<string, unknown> | null): { ok: true; value: NewOpportunity } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Formulaire vide." };
  const platform = isPlatform(raw.platform) ? raw.platform : null;
  if (!platform) return { ok: false, error: "Choisissez une plateforme." };
  const title = text(raw.title, 300);
  const body = text(raw.body, 20_000);
  if (!title) return { ok: false, error: "Le titre de l'annonce est obligatoire." };
  if (!body || body.length < 40) return { ok: false, error: "Collez le texte de l'annonce (au moins quelques lignes)." };
  const url = text(raw.url, 1000);
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: "L'URL doit commencer par http:// ou https://." };
  const deadline = text(raw.deadline, 10);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return { ok: false, error: "Date limite invalide." };
  return { ok: true, value: { platform, url, title, body, budget: text(raw.budget, 120), deadline } };
}

/**
 * Mise à jour du suivi : statut, notes, montant signé, texte de la proposition.
 * « Marquer envoyée » = statut `envoyee` + `sent_at` ; une réponse pose
 * `replied_at` (gardé si l'affaire est perdue ensuite).
 */
export function buildOpportunityPatch(
  raw: Record<string, unknown> | null,
  current: { status: OpportunityStatus; sent_at: string | null; replied_at: string | null },
  now = new Date(),
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Rien à enregistrer." };
  const patch: Record<string, unknown> = {};
  if ("status" in raw) {
    if (!isOpportunityStatus(raw.status)) return { ok: false, error: "Statut invalide." };
    patch.status = raw.status;
    if (raw.status !== "a_repondre" && raw.status !== "ignoree" && !current.sent_at) patch.sent_at = now.toISOString();
    if (REPLIED_STATUSES.includes(raw.status) && !current.replied_at) patch.replied_at = now.toISOString();
  }
  if ("notes" in raw) patch.notes = text(raw.notes, 5000);
  if ("proposal" in raw) {
    const proposal = text(raw.proposal, 10_000);
    if (!proposal) return { ok: false, error: "La proposition ne peut pas être vide." };
    patch.proposal = proposal;
  }
  if ("amount_eur" in raw) {
    if (raw.amount_eur === null || raw.amount_eur === "") patch.amount_eur = null;
    else {
      const amount = Number(String(raw.amount_eur).replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Le montant doit être un nombre positif." };
      patch.amount_eur = amount;
    }
  }
  if (!Object.keys(patch).length) return { ok: false, error: "Rien à enregistrer." };
  patch.updated_at = now.toISOString();
  return { ok: true, patch };
}
