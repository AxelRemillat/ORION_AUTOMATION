import { isBounce } from "./bounce";
import { isDeparted } from "./departed";

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
 *   - « absence » : réponse automatique, absence, out of office ;
 *   - « parti » : « je ne travaille plus chez … » (Cowork #54) — l'adresse ne
 *     servira plus : ses relances programmées sont annulées (lib/inbound/departed*.ts).
 * Ni l'une ni l'autre ne compte comme réponse, n'arrête les relances, ne fait
 * avancer le statut ou n'appelle de « Répondre » IA. Les rebonds restent gérés
 * à part (`isBounce`).
 */

export type AutoReplyKind = "antispam" | "absence" | "parti";

export interface MailLike {
  from_email: string;
  subject?: string | null;
  body?: string | null;
  /** En-tête `Auto-Submitted`, quand n8n le transmet (pas encore le cas). */
  auto_submitted?: string | null;
}

export const AUTO_REPLY_LABEL: Record<AutoReplyKind, string> = {
  antispam: "Validation anti-spam",
  absence: "Absence",
  parti: "Contact parti",
};

const ANTISPAM_SENDER = /mailinblack|@(?:[a-z0-9-]+\.)*(?:spamarrest|boxbe|sendio|altospam|humail|vadesecure)\.[a-z]+$/i;
const ANTISPAM_TEXT = [
  /un (?:seul |simple )?clic pour d[ée]livrer/i,
  /cliqu(?:ez|er) (?:ici |sur (?:ce|le) lien )?pour (?:d[ée]livrer|valider (?:votre|ce) (?:message|e-?mail|courriel))/i,
  /v[ée]rification (?:de l['’ ]?exp[ée]diteur|anti-?spam)/i,
  /sender verification|challenge[- ]response|verify (?:that )?you are (?:a )?(?:human|real person)/i,
  /(?:prouver|confirmer) que vous (?:n['’][êe]tes pas un robot|[êe]tes (?:un )?humain)/i,
  /(?:votre|ce) (?:message|e-?mail|courriel) (?:est |a été )?(?:en attente|bloqué|retenu)[^.\n]{0,60}(?:validation|d[ée]livr|authentifi)/i,
  // humail et les quarantaines (12/10/2026) : « en attente de libération ».
  /en attente de lib[ée]ration/i,
  /lib[ée]rer (?:ce|le|votre) (?:message|e-?mail|courriel)/i,
  /(?:message|e-?mail|courriel)[^.\n]{0,40}(?:mis|plac[ée])e?s? en quarantaine/i,
];

/**
 * Absences françaises SANS en-tête Auto-Submitted (Cowork #49, LSO MEDICAL, 12/10 : « Je serai indisponible du 12 au
 * 16 octobre inclus et prendrai connaissance de votre message à mon retour, le lundi 19 octobre. En cas d'urgence,
 * vous pouvez contacter… » classé « Réponse »).
 */
const ABSENCE_FR_2026 = [
  String.raw`je serai (?:absente?|indisponible|en cong[ée]s?|en d[ée]placement|en vacances|hors du bureau)`,
  String.raw`(?:je )?prendrai connaissance de (?:votre|vos) (?:message|mail|e-?mail|courriel)s?`,
  String.raw`en cas d['’]urgence,? (?:vous pouvez|merci de|veuillez|n['’]h[ée]sitez pas [àa]) (?:contacter|joindre|vous adresser|appeler|[ée]crire)`,
  String.raw`(?:je serai |je suis )?de retour (?:le|au bureau|lundi|mardi|mercredi|jeudi|vendredi)`,
  String.raw`i will be (?:unavailable|out of (?:the )?office|away)`,
].join("|");

const ABSENCE_SUBJECT = /r[ée]ponse automatique|message automatique|automatic reply|auto(?:matic)?[- ]?reply|autoreply|out of (?:the )?office|absen(?:t|te|ce) du bureau|message d['’]absence|^\s*(?:re\s*:\s*)?absen(?:t|te|ce)\b/i;
const ABSENCE_BODY = new RegExp(`${String.raw`je suis (?:actuellement )?(?:absente?|indisponible|en cong[ée]s?|en d[ée]placement|en vacances|en arr[êe]t)|i am (?:currently )?(?:out of (?:the )?office|away|on (?:annual )?leave)|r[ée]ponse automatique|message automatique|out of (?:the )?office`}|${ABSENCE_FR_2026}`, "i");
/** Un message d'absence le dit d'entrée : au-delà, c'est une vraie réponse qui en parle. */
const ABSENCE_LEAD = 300;

export function autoReplyKind(message: MailLike): AutoReplyKind | null {
  if (isBounce(message)) return null;
  const subject = message.subject ?? "";
  const body = message.body ?? "";
  if (ANTISPAM_SENDER.test((message.from_email ?? "").trim())) return "antispam";
  if (ANTISPAM_TEXT.some((pattern) => pattern.test(subject) || pattern.test(body))) return "antispam";
  // Avant l'absence : « Réponse automatique » + « je ne travaille plus chez … » est un départ.
  if (isDeparted(message)) return "parti";
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
 * Domaines des services anti-spam connus : le lien de validation y vit parfois
 * alors que le message part du domaine du client (quarantaine Altospam, Vade).
 */
const ANTISPAM_DOMAINS = ["mailinblack.com", "humail.fr", "humail.com", "altospam.com", "altospam.fr", "vadesecure.com", "vade.com", "spamarrest.com", "boxbe.com", "sendio.com"];

/** Images, feuilles de style, pixels : jamais un lien d'action. */
const NOT_A_LINK = /\.(?:png|jpe?g|gif|svg|webp|ico|bmp|css|js)(?:$|[?#])|\/logo|logo\.|\/img\/|\/images?\//i;
/** Un lien à ne JAMAIS proposer : il ferait l'inverse de ce qu'on veut. */
const HARMFUL = /unsubscribe|desabonn|se-desinscrire|optout|opt-out|blacklist|spam(?:-|_)?report|signaler/i;
/** Le chemin d'un lien d'action, chez tous les éditeurs visés. */
const ACTION_PATH = /invitation|validat|verif|confirm|release|liberer|liberation|delivr|deliver|unblock|authoriz|autoris|whitelist|approve|accept|debloqu/i;
/** Le texte autour du lien, en français comme en anglais. */
const ACTION_TEXT = /cliqu(?:ez|er)\s+(?:ici|sur)|un\s+(?:seul\s+)?clic|d[ée]livrer|lib[ée]rer|lib[ée]ration|valider|validation|confirmer|d[ée]bloquer|click\s+here|release|verify/i;
/** Un vrai lien de validation porte un jeton. */
const HAS_TOKEN = /[?&](?:token|t|id|key|hash|code|uid|k)=/i;

const plainLower = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Lien de validation d'un challenge anti-spam.
 *
 * 12/10/2026 : « prendre le premier lien https du domaine de l'expéditeur »
 * ouvrait l'IMAGE DU LOGO d'un mail Mailinblack
 * (app.mailinblack.com/…/unauthenticated/logo/…/logo.png), jamais l'invitation.
 * On classe donc les candidats au lieu de prendre le premier :
 *   - écartés : images et fichiers statiques, logos, et tout lien de
 *     désabonnement ou de signalement (il ferait le contraire du but) ;
 *   - retenus : les liens du domaine de l'expéditeur OU d'un éditeur anti-spam
 *     connu (Mailinblack, humail, Altospam, Vade, Protect…) — un lien vers
 *     n'importe quel autre domaine serait un risque, pas une validation ;
 *   - préférés : chemin d'action (invitation, validate, release, libérer…),
 *     texte d'action autour du lien (« Cliquez ici », « en attente de
 *     libération »), présence d'un jeton.
 * À égalité, le premier du corps gagne.
 */
export function antispamLink(message: MailLike): string | null {
  if (autoReplyKind(message) !== "antispam") return null;
  const senderHost = (message.from_email ?? "").split("@")[1] ?? "";
  const domain = senderHost ? baseDomain(senderHost) : null;
  const body = message.body ?? "";
  const allowed = [...(domain ? [domain] : []), ...ANTISPAM_DOMAINS];

  let best: { url: string; score: number } | null = null;
  for (const match of body.matchAll(/https:\/\/[^\s<>"'()[\]]+/gi)) {
    const candidate = match[0].replace(/[.,;:!?]+$/, "");
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue; // lien illisible : ignoré
    }
    if (url.protocol !== "https:") continue;
    const host = url.hostname.toLowerCase();
    if (!allowed.some((name) => host === name || host.endsWith(`.${name}`))) continue;
    if (NOT_A_LINK.test(candidate) || HARMFUL.test(candidate)) continue;

    // Le texte qui entoure le lien : « Cliquez ici » posé avant (corps texte)
    // comme après (ancre HTML).
    const around = plainLower(body.slice(Math.max(0, match.index - 120), match.index + candidate.length + 120));
    const score =
      (ACTION_PATH.test(url.pathname) ? 3 : 0) +
      (ACTION_TEXT.test(around) ? 2 : 0) +
      (HAS_TOKEN.test(candidate) ? 1 : 0);
    if (!best || score > best.score) best = { url: url.toString(), score };
  }
  return best?.url ?? null;
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
const RETURN_CUE = String.raw`(?:de retour|retour (?:pr[ée]vu )?le|[àa] mon retour|reprise|jusqu['’]au|absente? jusqu['’]au|back on|until)`;
const NUMERIC_DATE = new RegExp(`${RETURN_CUE}[^\\d\\n]{0,25}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?`, "i");
const TEXT_DATE = new RegExp(`${RETURN_CUE}[^\\n]{0,25}?(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join("|")})(?:\\s+(\\d{4}))?`, "i");
/** « indisponible du 12 au 16 octobre (inclus) » : sans date de retour explicite, le retour est le lendemain du dernier jour. */
const RANGE_DATE = new RegExp(`(?:absente?|indisponible|en cong[ée]s?|en vacances|en d[ée]placement)[^\\n]{0,20}?\\bdu\\s+\\d{1,2}(?:er)?(?:\\s+(?:${Object.keys(MONTHS).join("|")}))?\\s+au\\s+(\\d{1,2})(?:er)?\\s+(${Object.keys(MONTHS).join("|")})(?:\\s+(\\d{4}))?`, "i");

/**
 * Date de retour d'un message d'absence (« de retour le 12/10 », « absent
 * jusqu'au 14 octobre »), au format AAAA-MM-JJ. `null` si rien de sûr : on ne
 * devine pas. Sans année, la prochaine occurrence après la réception.
 */
export function absenceReturnDate(message: MailLike & { received_at: string }): string | null {
  const text = `${message.subject ?? ""}\n${message.body ?? ""}`;
  const numeric = NUMERIC_DATE.exec(text);
  const textual = numeric ? null : TEXT_DATE.exec(text);
  // Une date de retour EXPLICITE prime ; à défaut, la fin d'une période d'absence + 1 jour (Cowork #49).
  const range = numeric || textual ? null : RANGE_DATE.exec(text);
  const found = numeric ?? textual ?? range;
  const day = Number(found?.[1]) + (range ? 1 : 0);
  const month = numeric ? Number(numeric[2]) : (textual ?? range) ? MONTHS[(textual ?? range)![2].toLowerCase()] : NaN;
  const rawYear = found?.[3];
  if (!day || !month || Number(found?.[1]) > 31 || month > 12) return null;
  const received = new Date(message.received_at);
  let year = rawYear ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear) : received.getUTCFullYear();
  let at = Date.UTC(year, month - 1, day);
  if (!rawYear && at < received.getTime() - 86_400_000) at = Date.UTC((year += 1), month - 1, day);
  // Une date passée ou à plus de 4 mois n'est pas une date de retour exploitable.
  if (at < received.getTime() - 86_400_000 || at > received.getTime() + 120 * 86_400_000) return null;
  const date = new Date(at);
  // « au 31 octobre » + 1 jour passe au mois suivant : seul ce cas est permis.
  if (date.getUTCDate() !== day && !(range && date.getUTCDate() === 1)) return null;
  return date.toISOString().slice(0, 10);
}
