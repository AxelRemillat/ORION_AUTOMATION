import type { Notification } from "@/lib/notify/ntfy";
import { readUpworkBudget } from "../upwork-launch";
import { publishedUpworkProjects } from "../upwork-portfolio";
import type { EmailJob, EmailKind, InboundEmail } from "./parse";

/**
 * VEILLE UPWORK PAR E-MAIL (Cowork #68) — code PUR, testable sans base ni modèle.
 *
 * Upwork n'a plus de flux RSS et son API demande une validation : la veille passe UNIQUEMENT par les e-mails que
 * le workflow n8n relève (`from:upwork.com`). Trois familles :
 *   a) alertes d'offres (recherche enregistrée, recommandations) : une opportunité par offre, notée par le moteur
 *      Codeur puis ajustée ici avec les critères Upwork ;
 *   b) message d'un client, invitation à un entretien, offre de contrat : un ÉVÉNEMENT prioritaire, pas une
 *      opportunité classique — alerte URGENTE vers le lien de l'e-mail ;
 *   c) le reste (newsletters, Connects, astuces) : ignoré, sans alerte.
 */

/** Types d'e-mail Upwork qui sont un événement prioritaire (b). */
export const UPWORK_EVENT_KINDS: readonly EmailKind[] = ["message", "invitation", "offre"];

export const isUpworkEvent = (kind: EmailKind) => UPWORK_EVENT_KINDS.includes(kind);

const EVENT_LABEL: Partial<Record<EmailKind, string>> = { message: "nouveau message", invitation: "invitation", offre: "offre de contrat" };

/** Expéditeur tel que l'e-mail l'affiche (« Jane D. via Upwork »), à défaut l'adresse. */
export function senderOf(from: string): string {
  const display = from.replace(/<[^>]*>/g, "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
  return display || from.replace(/[<>]/g, "").trim() || "Upwork";
}

/** Liens upwork.com de l'e-mail (texte et HTML), décodés. */
function upworkLinks(email: Pick<InboundEmail, "text" | "html">): string[] {
  const raw = [...`${email.text}\n${email.html}`.matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)].map((match) => match[0].replace(/&amp;/g, "&"));
  const decoded = raw.map((link) => {
    try {
      return decodeURIComponent(link);
    } catch {
      return link;
    }
  });
  return [...new Set(decoded.flatMap((link) => [link, ...(link.match(/https?:\/\/(?:www\.)?upwork\.com[^\s"'<>]*/gi) ?? [])]))].filter((link) => /^https?:\/\/(?:[\w-]+\.)?upwork\.com\//i.test(link));
}

const EVENT_LINK = /upwork\.com\/(?:ab\/|nx\/)?(?:messages|rooms|offers?|invitations?|contracts?|proposals?|jobs\/~)/i;

/** Le lien que l'alerte ouvre : la conversation, l'invitation ou l'offre ; à défaut, la messagerie Upwork. */
export function upworkEventLink(email: Pick<InboundEmail, "text" | "html">, fallback: string | null): string {
  const links = upworkLinks(email).filter((link) => !/unsubscribe|settings|notification/i.test(link));
  // La conversation, l'invitation ou l'offre d'abord ; l'annonce seulement à défaut.
  return links.find((link) => EVENT_LINK.test(link) && !/\/jobs\/~/i.test(link)) ?? links.find((link) => EVENT_LINK.test(link)) ?? fallback ?? "https://www.upwork.com/nx/messages/";
}

export interface UpworkEvent {
  kind: EmailKind;
  label: string;
  sender: string;
  subject: string;
  link: string;
}

export function upworkEvent(email: InboundEmail, kind: EmailKind, parsedUrl: string | null): UpworkEvent {
  return { kind, label: EVENT_LABEL[kind] ?? "nouveau message", sender: senderOf(email.from), subject: email.subject.trim(), link: upworkEventLink(email, parsedUrl) };
}

/** Alerte URGENTE (priorité max de ntfy) : « Upwork – nouveau message », « Upwork – invitation »… */
export function upworkEventAlert(event: UpworkEvent): Notification {
  return {
    title: `Upwork – ${event.label}`,
    body: `${event.sender} : ${event.subject}`.slice(0, 500),
    priority: "urgent",
    tags: ["rotating_light"],
    click: event.link,
  };
}

// --- (a) Offres : critères Upwork ajoutés au score du moteur Codeur ---------------------------

export const UPWORK_MIN_FIXED_USD = 100;
export const UPWORK_MIN_HOURLY_USD = 20;
export const UPWORK_ALERT_SCORE = 7;

/** Le métier d'Axel au-delà des usages exacts du portfolio (automatisation, IA, intégration). */
const CORE_SKILLS = /\bn8n\b|automat|workflow|zapier|make\.com|integromat|ai agent|\bagents?\b|openai|\bgpt|\bllm|chat ?bot|\brag\b|integration|\bapi\b|extract|\bocr\b|lead gen/i;

/** L'annonce exige une expérience ou des avis qu'un profil Upwork récent n'a pas encore. */
const EXPERIENCE_REQUIRED =
  /top[- ]rated|expert[- ]vetted|\bjss\b|job success( score)?|\d+\s?%\s?(job success|jss)|\d+\+?\s?(years?|yrs) (of )?(experience|exp)|(at least|minimum( of)?|min\.?)\s?\d+\+?\s?(years?|reviews|jobs|projects)|proven track record|(must|should) have (completed|done|built) (\d+|several|many|multiple)|only (freelancers|candidates|applicants) with|(5|five)[- ]star reviews/i;

export interface UpworkSignals {
  /** « Proposals: 5 to 10 », tel que l'e-mail le donne ; `null` s'il ne le dit pas. */
  proposals: string | null;
  /** `true` / `false` si l'e-mail le dit ; `null` sinon — jamais deviné. */
  paymentVerified: boolean | null;
}

export function upworkSignals(text: string): UpworkSignals {
  const proposals = text.match(/proposals?\s*:?\s*(less than \d+|fewer than \d+|\d+\s?(?:to|-|–)\s?\d+|\d+\+|\d+)/i)?.[1]?.trim() ?? null;
  const unverified = /payment (method )?(un ?verified|not verified)/i.test(text);
  const verified = !unverified && /payment (method )?verified/i.test(text);
  return { proposals, paymentVerified: unverified ? false : verified ? true : null };
}

const lowCompetition = (proposals: string | null) => Boolean(proposals && /^(less than|fewer than)\s*(5|10)$|^[0-4]$/i.test(proposals));
const highCompetition = (proposals: string | null) => Boolean(proposals && /^(50\+|\d{2,}\+|[5-9]\d)$|^(20|50)\s?(to|-|–)\s?\d+$/i.test(proposals));

export interface UpworkJobScore {
  score: number | null;
  reasons: string[];
  signals: UpworkSignals;
}

/**
 * Score Upwork d'une offre : le score du moteur Codeur (analyse du modèle), ajusté par des critères VISIBLES dans
 * l'e-mail. `base` absent (analyse indisponible, filtrée) : aucun score inventé.
 */
export function upworkJobScore(base: number | null, job: Pick<EmailJob, "title" | "snippet" | "budget">): UpworkJobScore {
  const text = `${job.title}\n${job.snippet}`;
  const signals = upworkSignals(text);
  if (base === null) return { score: null, reasons: [], signals };
  let score = base;
  const reasons: string[] = [];

  const budget = readUpworkBudget(job.budget ?? "");
  if (budget.kind === "fixed" && budget.usd !== null && budget.usd < UPWORK_MIN_FIXED_USD) {
    score = Math.min(score, 4);
    reasons.push(`budget fixe de ${budget.usd} $ : sous ${UPWORK_MIN_FIXED_USD} $`);
  } else if (budget.kind === "hourly" && budget.usd !== null && budget.usd < UPWORK_MIN_HOURLY_USD) {
    score = Math.min(score, 4);
    reasons.push(`taux de ${budget.usd} $/h : sous ${UPWORK_MIN_HOURLY_USD} $/h`);
  }

  const fits = publishedUpworkProjects().some((project) => project.usages.test(text) && !project.exclut?.test(text)) || CORE_SKILLS.test(text);
  if (!fits) {
    score -= 2;
    reasons.push("hors du portfolio Upwork (ni automatisation, ni agent IA, ni chatbot, ni extraction, ni lead generation)");
  }

  if (EXPERIENCE_REQUIRED.test(text)) {
    score -= 2;
    reasons.push("demande une expérience ou des avis qu'un profil récent n'a pas encore");
  }

  if (lowCompetition(signals.proposals)) {
    score += 1;
    reasons.push(`peu de concurrence (propositions : ${signals.proposals})`);
  } else if (highCompetition(signals.proposals)) {
    score -= 1;
    reasons.push(`forte concurrence (propositions : ${signals.proposals})`);
  }
  if (signals.paymentVerified === false) {
    score -= 1;
    reasons.push("paiement du client non vérifié");
  }

  return { score: Math.max(0, Math.min(10, Math.round(score))), reasons, signals };
}

/** Alerte d'une offre notée ≥ 7 : « Upwork 8/10 – <titre> », vers l'offre. */
export function upworkJobAlert(job: Pick<EmailJob, "title" | "url" | "budget">, scored: UpworkJobScore, orionUrl: string): Notification {
  const details = [
    job.budget ? `Budget : ${job.budget}.` : null,
    scored.signals.proposals ? `Propositions : ${scored.signals.proposals}.` : null,
    scored.signals.paymentVerified === true ? "Paiement vérifié." : null,
    ...scored.reasons.slice(0, 2).map((reason) => `${reason[0].toUpperCase()}${reason.slice(1)}.`),
  ].filter(Boolean);
  return {
    title: `Upwork ${scored.score}/10 – ${job.title}`,
    body: [...details, "Proposition prête dans ORION (onglet Upwork)."].join(" ").slice(0, 500),
    priority: "high",
    tags: ["briefcase"],
    click: job.url ?? orionUrl,
  };
}
