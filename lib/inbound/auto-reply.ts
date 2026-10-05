import { isBounce } from "./bounce";

/**
 * Réponses AUTOMATIQUES — ce ne sont pas des réponses du prospect.
 *
 * 05/10/2026 : AKTID « a répondu » par un challenge anti-spam Mailinblack
 * (« UN CLIC POUR DÉLIVRER VOTRE EMAIL », aktid@invitations.mailinblack.com).
 * Classé « Question » par n8n, il comptait dans le taux de réponse.
 *
 * Deux familles, reconnues sur le CONTENU (expéditeur, objet, corps) : la
 * classification se recalcule à chaque lecture, donc les mails déjà reçus sont
 * reclassés sans toucher à la base.
 *   - « antispam » : challenge-response (Mailinblack et consorts) — il faut
 *     cliquer un lien pour que le mail soit délivré ;
 *   - « absence » : réponse automatique, absence, out of office.
 * Ni l'une ni l'autre ne compte comme réponse, n'arrête les relances, ne fait
 * avancer le statut ou n'appelle de « Répondre » IA. Les rebonds restent gérés
 * à part (`isBounce`).
 */

export type AutoReplyKind = "antispam" | "absence";

export interface MailLike {
  from_email: string;
  subject?: string | null;
  body?: string | null;
  /** En-tête `Auto-Submitted`, quand n8n le transmet (pas encore le cas). */
  auto_submitted?: string | null;
}

export const AUTO_REPLY_LABEL: Record<AutoReplyKind, string> = {
  antispam: "Validation anti-spam",
  absence: "Réponse auto",
};

const ANTISPAM_SENDER = /mailinblack|@(?:[a-z0-9-]+\.)*(?:spamarrest|boxbe|sendio|altospam)\.[a-z]+$/i;
const ANTISPAM_TEXT = [
  /un (?:seul |simple )?clic pour d[ée]livrer/i,
  /cliqu(?:ez|er) (?:ici |sur (?:ce|le) lien )?pour (?:d[ée]livrer|valider (?:votre|ce) (?:message|e-?mail|courriel))/i,
  /v[ée]rification (?:de l['’ ]?exp[ée]diteur|anti-?spam)/i,
  /sender verification|challenge[- ]response|verify (?:that )?you are (?:a )?(?:human|real person)/i,
  /(?:prouver|confirmer) que vous (?:n['’][êe]tes pas un robot|[êe]tes (?:un )?humain)/i,
  /(?:votre|ce) (?:message|e-?mail|courriel) (?:est |a été )?(?:en attente|bloqué|retenu)[^.\n]{0,60}(?:validation|d[ée]livr|authentifi)/i,
];

const ABSENCE_SUBJECT = /r[ée]ponse automatique|message automatique|automatic reply|auto(?:matic)?[- ]?reply|autoreply|out of (?:the )?office|absen(?:t|te|ce) du bureau|message d['’]absence|^\s*(?:re\s*:\s*)?absen(?:t|te|ce)\b/i;
const ABSENCE_BODY = /je suis (?:actuellement )?(?:absente?|en cong[ée]s?|en d[ée]placement|en vacances|en arr[êe]t)|i am (?:currently )?(?:out of (?:the )?office|away|on (?:annual )?leave)|r[ée]ponse automatique|message automatique|out of (?:the )?office/i;
/** Un message d'absence le dit d'entrée : au-delà, c'est une vraie réponse qui en parle. */
const ABSENCE_LEAD = 300;

export function autoReplyKind(message: MailLike): AutoReplyKind | null {
  if (isBounce(message)) return null;
  const subject = message.subject ?? "";
  const body = message.body ?? "";
  if (ANTISPAM_SENDER.test((message.from_email ?? "").trim())) return "antispam";
  if (ANTISPAM_TEXT.some((pattern) => pattern.test(subject) || pattern.test(body))) return "antispam";
  if (message.auto_submitted && /auto-(?:replied|generated)/i.test(message.auto_submitted)) return "absence";
  if (ABSENCE_SUBJECT.test(subject)) return "absence";
  if (body.length <= 1500 && ABSENCE_BODY.test(body.slice(0, ABSENCE_LEAD))) return "absence";
  return null;
}

/** Une vraie réponse du prospect : ni rebond, ni réponse automatique. */
export function isProspectReply(message: MailLike): boolean {
  return !isBounce(message) && !autoReplyKind(message);
}

/** Domaine « enregistrable » : invitations.mailinblack.com → mailinblack.com. */
function baseDomain(host: string): string {
  return host.toLowerCase().split(".").filter(Boolean).slice(-2).join(".");
}

/**
 * Lien de validation d'un challenge anti-spam : le premier lien https du corps
 * dont le domaine est CELUI DE L'EXPÉDITEUR anti-spam. Aucun autre lien n'est
 * proposé (un lien vers un autre domaine serait un risque, pas une validation).
 */
export function antispamLink(message: MailLike): string | null {
  if (autoReplyKind(message) !== "antispam") return null;
  const senderHost = (message.from_email ?? "").split("@")[1] ?? "";
  if (!senderHost) return null;
  const domain = baseDomain(senderHost);
  for (const raw of (message.body ?? "").match(/https:\/\/[^\s<>"'()[\]]+/gi) ?? []) {
    const candidate = raw.replace(/[.,;:!?]+$/, "");
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase();
      if (url.protocol === "https:" && (host === domain || host.endsWith(`.${domain}`))) return url.toString();
    } catch {
      // lien illisible : ignoré
    }
  }
  return null;
}

/**
 * Pistes pour rattacher un challenge anti-spam à son prospect : l'expéditeur
 * (aktid@invitations.mailinblack.com) n'est pas l'adresse du prospect.
 *   - les adresses citées dans l'objet ou le corps (le destinataire protégé) ;
 *   - la partie locale de l'expéditeur (« aktid »), à comparer au domaine du prospect.
 */
export function antispamProspectHints(message: MailLike): { emails: string[]; label: string | null } {
  const from = (message.from_email ?? "").toLowerCase();
  const found = `${message.subject ?? ""}\n${message.body ?? ""}`.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  const emails = [...new Set(found.map((email) => email.toLowerCase()))].filter((email) => email !== from && !ANTISPAM_SENDER.test(email)).slice(0, 5);
  const local = from.split("@")[0] ?? "";
  const label = /^[a-z0-9-]{3,}$/.test(local) && !/^(?:no-?reply|ne-?pas-?repondre|invitations?|support|contact|info)$/.test(local) ? local : null;
  return { emails, label };
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};
const RETURN_CUE = String.raw`(?:de retour|retour (?:pr[ée]vu )?le|reprise|jusqu['’]au|absente? jusqu['’]au|back on|until)`;
const NUMERIC_DATE = new RegExp(`${RETURN_CUE}[^\\d\\n]{0,25}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?`, "i");
const TEXT_DATE = new RegExp(`${RETURN_CUE}[^\\n]{0,25}?(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join("|")})(?:\\s+(\\d{4}))?`, "i");

/**
 * Date de retour d'un message d'absence (« de retour le 12/10 », « absent
 * jusqu'au 14 octobre »), au format AAAA-MM-JJ. `null` si rien de sûr : on ne
 * devine pas. Sans année, la prochaine occurrence après la réception.
 */
export function absenceReturnDate(message: MailLike & { received_at: string }): string | null {
  const text = `${message.subject ?? ""}\n${message.body ?? ""}`;
  const numeric = NUMERIC_DATE.exec(text);
  const textual = numeric ? null : TEXT_DATE.exec(text);
  const day = Number((numeric ?? textual)?.[1]);
  const month = numeric ? Number(numeric[2]) : textual ? MONTHS[textual[2].toLowerCase()] : NaN;
  const rawYear = (numeric ?? textual)?.[3];
  if (!day || !month || day > 31 || month > 12) return null;
  const received = new Date(message.received_at);
  let year = rawYear ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear) : received.getUTCFullYear();
  let at = Date.UTC(year, month - 1, day);
  if (!rawYear && at < received.getTime() - 86_400_000) at = Date.UTC((year += 1), month - 1, day);
  // Une date passée ou à plus de 4 mois n'est pas une date de retour exploitable.
  if (at < received.getTime() - 86_400_000 || at > received.getTime() + 120 * 86_400_000) return null;
  const date = new Date(at);
  if (date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}
