import type { AskFn } from "@/lib/ai/chat";
import { ANY_URL, CONTACT_EMAIL, CONTACT_PHONE, CALENDAR_LINK, isNoContactPlatform } from "./proposal";
import { proposalLanguage, type Language, type Opportunity, type Platform } from "./types";

/**
 * RELANCES SUGGÉRÉES (plateformes #6) — une proposition « Envoyée » restée
 * sans réponse depuis 3 jours (Codeur, Malt, ComeUp) ou 5 jours (Upwork,
 * Autre) appelle UNE relance courte, à copier par Axel. Rien n'est envoyé.
 *
 * Le texte est rédigé par le modèle (un appel, une reprise au plus) et
 * contrôlé par le code : moins de 400 caractères, aucune coordonnée — aucune
 * URL non plus sur Codeur, Malt et ComeUp. À défaut, un modèle de texte sûr.
 */

export { daysSinceSent, dueFollowUps, FOLLOW_UP_DAYS, followUpDue } from "./follow-up-due";

export const FOLLOW_UP_MAX_CHARS = 400;

/** Contrôles du code sur le texte de relance (vide = acceptable). */
export function followUpFailures(text: string, platform: Platform): string[] {
  const failures: string[] = [];
  if (!text.trim()) failures.push("Texte vide.");
  if (text.length >= FOLLOW_UP_MAX_CHARS) failures.push(`${text.length} caractères : ${FOLLOW_UP_MAX_CHARS - 1} au plus.`);
  if (CONTACT_EMAIL.test(text)) failures.push("Adresse e-mail : aucune coordonnée.");
  if (CONTACT_PHONE.test(text)) failures.push("Téléphone : aucune coordonnée.");
  if (CALENDAR_LINK.test(text)) failures.push("Lien de rendez-vous : interdit.");
  if (isNoContactPlatform(platform) && ANY_URL.test(text)) failures.push("Aucune URL sur cette plateforme (contact hors plateforme interdit).");
  return failures;
}

/** Nom seul : jamais de site ni de coordonnée dans une relance. */
const SIGNATURE = "Axel Remillat";

/** Modèle de texte sûr (aucune coordonnée), si le modèle de langue ne rend rien d'utilisable. */
export function fallbackFollowUp(row: Pick<Opportunity, "platform" | "title">, language: Language): string {
  const title = row.title.length > 90 ? `${row.title.slice(0, 87)}…` : row.title;
  return language === "en"
    ? `Hi, following up on my proposal for "${title}". I'm available to start this week and can adapt the scope to your priorities. Is there any detail I can clarify to help your decision?\n\n${SIGNATURE}`
    : `Bonjour, je reviens vers vous au sujet de ma proposition pour « ${title} ». Je suis disponible pour démarrer cette semaine et peux ajuster le périmètre à vos priorités. Y a-t-il un point que je peux préciser pour vous aider à décider ?\n\n${SIGNATURE}`;
}

export function buildFollowUpPrompt(platform: Platform, language: Language): string {
  const en = language === "en";
  return `Tu écris, pour Axel Remillat (indépendant en IA et automatisation), la RELANCE d'une proposition envoyée sur ${platform} restée sans réponse.
Langue : ${en ? "ANGLAIS, simple et direct" : "FRANÇAIS, vouvoiement"}.
Forme : ${en ? "« Hi, »" : "« Bonjour, »"} puis 2 phrases au plus : rappelle UN élément concret du besoin du client (pas « mon offre »), puis une question simple qui appelle une réponse. Signature « Axel Remillat » sur sa propre ligne.
Moins de ${FOLLOW_UP_MAX_CHARS - 40} caractères au total. Ni insistance, ni excuse, ni flatterie, ni promesse chiffrée.
INTERDITS : toute adresse e-mail, tout téléphone, tout lien de rendez-vous${isNoContactPlatform(platform) ? ", TOUTE URL ou nom de site (la plateforme interdit tout contact hors plateforme)" : ""}.
Réponds UNIQUEMENT en JSON : {"text":"…"}`;
}

export interface FollowUpOutcome {
  text: string;
  /** `fallback` : le modèle n'a rien rendu d'acceptable, texte de repli. */
  source: "llm" | "fallback";
}

export async function generateFollowUp(
  ask: AskFn,
  row: Pick<Opportunity, "platform" | "title" | "need" | "proposal" | "language">,
): Promise<FollowUpOutcome> {
  const language = proposalLanguage(row.platform, row.language);
  const user = `ANNONCE : ${row.title}\nBESOIN : ${row.need ?? "non précisé"}\n\nPROPOSITION ENVOYÉE :\n${(row.proposal ?? "").slice(0, 1500)}`;
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await ask("writer", buildFollowUpPrompt(row.platform, language) + feedback, user, 0.5, `opportunites:relance${attempt ? ":rewrite" : ""}`).catch(() => "");
    let text = "";
    try {
      const value = JSON.parse(raw) as { text?: unknown };
      text = typeof value.text === "string" ? value.text.trim() : "";
    } catch {
      text = "";
    }
    const failures = followUpFailures(text, row.platform);
    if (!failures.length) return { text, source: "llm" };
    feedback = `\n\nVERSION PRÉCÉDENTE REFUSÉE : ${failures.join(" ")}`;
  }
  return { text: fallbackFollowUp(row, language), source: "fallback" };
}
