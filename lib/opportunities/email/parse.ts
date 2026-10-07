import type { Platform } from "../types";

/**
 * E-MAILS DES PLATEFORMES FREELANCE (plateformes #1, 07/10/2026) — code pur.
 *
 * Upwork n'a plus de flux RSS, Malt et ComeUp n'ont pas de flux d'annonces :
 * invitations, demandes, commandes, messages et recommandations arrivent par
 * e-mail. Un workflow n8n Gmail dédié pousse chaque e-mail tel quel ; ce
 * module reconnaît la plateforme (domaine de l'expéditeur), le TYPE d'e-mail
 * (sujet, puis corps) et extrait titre, lien, identifiant, client et budget.
 *
 * Rien n'est lu sur les sites des plateformes : seulement le contenu de
 * l'e-mail reçu. Un e-mail non reconnu est « à trier » (jamais d'alerte).
 */

export interface InboundEmail {
  message_id: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  received_at: string | null;
}

export type EmailKind = "invitation" | "demande" | "commande" | "message" | "offre" | "gagnee" | "perdue" | "recommandation" | "nouveau_projet" | "autre";

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  invitation: "Invitation",
  demande: "Nouvelle demande",
  commande: "Commande",
  message: "Message",
  offre: "Offre reçue",
  gagnee: "Mission confirmée",
  perdue: "Clôturée",
  recommandation: "Recommandation",
  nouveau_projet: "Nouveau projet",
  autre: "À trier",
};

/** Types qui déclenchent une alerte téléphone : un client vient vers Axel. */
export const ALERT_KINDS: readonly EmailKind[] = ["invitation", "demande", "commande"];

export interface EmailJob {
  title: string;
  url: string | null;
  externalId: string | null;
  budget: string | null;
  snippet: string;
}

export interface ParsedEmail {
  platform: Platform | null;
  kind: EmailKind;
  title: string | null;
  url: string | null;
  externalId: string | null;
  clientName: string | null;
  budget: string | null;
  /** Montant d'une commande (ComeUp), en euros. */
  amountEur: number | null;
  /** Texte lisible de l'e-mail (HTML converti si le texte manque). */
  body: string;
  /** Recommandations : une annonce par entrée. */
  jobs: EmailJob[];
}

// --- Validation du corps reçu --------------------------------------------------

const str = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

export function parseInboundEmail(raw: Record<string, unknown> | null): { ok: true; value: InboundEmail } | { ok: false; error: string } {
  if (!raw) return { ok: false, error: "Corps JSON attendu." };
  const messageId = str(raw.message_id, 300).trim();
  if (!messageId) return { ok: false, error: "message_id est obligatoire." };
  const text = str(raw.text, 100_000);
  const html = str(raw.html, 300_000);
  const subject = str(raw.subject, 500).trim();
  if (!subject && !text.trim() && !html.trim()) return { ok: false, error: "E-mail vide : subject, text ou html attendu." };
  const received = str(raw.received_at, 60).trim();
  return {
    ok: true,
    value: {
      message_id: messageId,
      from: str(raw.from, 500).trim(),
      subject,
      text,
      html,
      received_at: received && !Number.isNaN(Date.parse(received)) ? new Date(received).toISOString() : null,
    },
  };
}

// --- Texte ---------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê", hellip: "…", euro: "€", ndash: "–", mdash: "—" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HTML → texte lisible (paragraphes conservés, styles et scripts retirés). */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function emailText(email: Pick<InboundEmail, "text" | "html">): string {
  const text = email.text.trim();
  return text.length >= 40 || !email.html.trim() ? text : htmlToText(email.html);
}

const plain = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// --- Plateforme ----------------------------------------------------------------

/** Domaines d'expédition reconnus (Cowork : filtre Gmail du workflow n8n). */
export const SENDER_DOMAINS: Record<Exclude<Platform, "autre">, readonly string[]> = {
  upwork: ["upwork.com"],
  malt: ["malt.fr", "malt.com", "malt.de", "malt.es", "malt.be", "malt.nl", "malt.ch"],
  comeup: ["comeup.com", "5euros.com"],
  codeur: ["codeur.com"],
};

/** Adresse de l'expéditeur (« Upwork <donotreply@upwork.com> » → donotreply@upwork.com). */
export function senderAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  return (angle ? angle[1] : from).trim().toLowerCase();
}

export function platformOfSender(from: string): Platform | null {
  const domain = senderAddress(from).split("@")[1] ?? "";
  for (const [platform, domains] of Object.entries(SENDER_DOMAINS) as [Platform, readonly string[]][]) {
    if (domains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) return platform;
  }
  return null;
}

// --- Type d'e-mail : règles par plateforme --------------------------------------

interface KindRule {
  kind: EmailKind;
  subject: RegExp;
}

/**
 * Sujets reconnus (sur le sujet sans accents, en minuscules). L'ordre compte :
 * le premier qui correspond l'emporte (une offre n'est pas un message).
 */
type ParsedPlatform = "upwork" | "malt" | "comeup" | "codeur";

export const SUBJECT_RULES: Record<ParsedPlatform, readonly KindRule[]> = {
  upwork: [
    { kind: "gagnee", subject: /(contract (has )?(started|begun)|offer (was |has been )?accepted|you('ve| have) been hired|hired you|your contract with)/ },
    { kind: "perdue", subject: /(proposal (was |has been )?declined|declined your proposal|job (posting )?(has been |was )?(closed|cancelled|canceled|removed)|no longer (available|accepting)|(position|job) (has been )?filled|hired (someone|another freelancer))/ },
    { kind: "offre", subject: /(sent you an offer|received an offer|new offer|offer from|you have an offer)/ },
    { kind: "invitation", subject: /(invit(ed|ation)|wants you to (apply|interview)|requested? (a |your )?proposal)/ },
    { kind: "recommandation", subject: /(jobs? (recommended|you might like|for you|matching|alert)|recommended jobs?|new jobs? (for|matching|that match)|jobs? that match|top job picks|job picks)/ },
    { kind: "message", subject: /(new message|sent you a message|unread messages?|message from|replied to|responded to your proposal|messaged you)/ },
  ],
  malt: [
    { kind: "gagnee", subject: /((devis|proposition) (a ete )?accepte|a accepte (votre|le|la) (devis|proposition)|mission (confirmee|a demarre|commence|validee)|projet confirme|vous a choisi)/ },
    { kind: "perdue", subject: /((devis|proposition) (a ete )?(refuse|decline)|a (refuse|decline) (votre|le|la) (devis|proposition)|projet (annule|cloture|pourvu)|a choisi un autre|n'a pas retenu)/ },
    { kind: "demande", subject: /(nouvelle (demande|proposition) de (projet|mission)|(demande|proposition) de projet|souhaite (travailler|collaborer|vous confier)|demande de devis|nouvelle opportunite|vous a contacte|nouveau projet pour vous|un client (vous a contacte|souhaite))/ },
    { kind: "message", subject: /(nouveau message|vous a (envoye|ecrit) un message|a repondu|message de|vous a ecrit)/ },
    { kind: "recommandation", subject: /(projets? (qui pourrai|recommande|pour vous)|opportunites? (pour vous|qui))/ },
  ],
  comeup: [
    { kind: "perdue", subject: /(commande (a ete )?annulee|annulation de (la |votre )?commande)/ },
    { kind: "commande", subject: /(nouvelle commande|vous avez (recu |une )?(une )?(nouvelle )?commande|a commande|commande (n°|no|#)?\s?\d+ (recue|passee))/ },
    { kind: "demande", subject: /(demande personnalisee|offre personnalisee|nouvelle demande|demande de devis|souhaite (vous commander|commander)|demande (de|d')?(service|prestation))/ },
    { kind: "message", subject: /(nouveau message|vous a envoye un message|a repondu|message de)/ },
  ],
  // Codeur (plateformes #6) : SUIVI seulement — les annonces arrivent par le flux RSS.
  codeur: [
    // Alerte « Nouveau projet : <titre> » (notification@compte.codeur.com, plateformes #7) : double le flux RSS.
    { kind: "nouveau_projet", subject: /^\W*(\[?codeur(\.com)?\]?\s*[:-]?\s*)?nouveau projet\s*[:-]/ },
    { kind: "gagnee", subject: /((projet|mission) .{0,120}?(vous )?a ete attribue|vous a ete attribue|vous avez ete (selectionne|retenu|choisi)|votre (offre|proposition) a ete (acceptee|retenue)|attribution du projet)/ },
    { kind: "perdue", subject: /((offre|proposition) (n'a pas ete retenue|a ete refusee|refusee|declinee)|n'a pas retenu votre|projet .{0,120}?(a ete )?(ferme|clos|cloture|annule|attribue a un autre)|(fermeture|cloture) du projet|projet (ferme|clos|cloture|annule))/ },
    { kind: "message", subject: /(nouveau message|vous a (envoye|ecrit) un message|message prive|a repondu a votre offre|message de)/ },
  ],
};

/** Au défaut du sujet, quelques indices du corps (même ordre de priorité). */
const BODY_HINTS: Record<ParsedPlatform, readonly KindRule[]> = {
  upwork: [
    { kind: "invitation", subject: /(invited you to (interview|apply|submit)|has invited you)/ },
    { kind: "offre", subject: /(sent you an offer|accept the offer)/ },
  ],
  malt: [{ kind: "demande", subject: /(souhaite vous confier|vous propose un projet|demande de projet)/ }],
  comeup: [{ kind: "commande", subject: /(a passe (une )?commande|nouvelle commande)/ }],
  codeur: [{ kind: "message", subject: /(vous a envoye un message|a repondu a votre offre)/ }],
};

export function kindOf(platform: Platform | null, subject: string, body: string): EmailKind {
  if (platform !== "upwork" && platform !== "malt" && platform !== "comeup" && platform !== "codeur") return "autre";
  const subjectPlain = plain(subject);
  const bySubject = SUBJECT_RULES[platform].find((rule) => rule.subject.test(subjectPlain));
  if (bySubject) return bySubject.kind;
  const bodyPlain = plain(body.slice(0, 3000));
  return BODY_HINTS[platform].find((rule) => rule.subject.test(bodyPlain))?.kind ?? "autre";
}

// --- Extraction ----------------------------------------------------------------

/** Liens présents dans le texte ET dans les href du HTML (dé-encodés une fois). */
export function emailLinks(email: Pick<InboundEmail, "text" | "html">): string[] {
  const links = [
    ...[...email.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => decodeEntities(match[1])),
    ...[...email.text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((match) => match[0]),
  ];
  const decoded = links.map((link) => {
    try {
      return decodeURIComponent(link);
    } catch {
      return link;
    }
  });
  return [...new Set(decoded)];
}

/** Identifiant d'annonce Upwork : « ~01… » (dans l'URL du job, même derrière un lien de suivi). */
export const UPWORK_JOB_ID = /~0[0-9a-z]{10,24}/i;

function platformLink(platform: Platform, links: string[]): { url: string | null; externalId: string | null } {
  if (platform === "upwork") {
    const job = links.find((link) => /upwork\.com/i.test(link) && UPWORK_JOB_ID.test(link));
    const id = job?.match(UPWORK_JOB_ID)?.[0].toLowerCase() ?? null;
    return { url: id ? `https://www.upwork.com/jobs/${id}` : (links.find((link) => /upwork\.com\/(ab\/)?(messages|jobs|nx)/i.test(link)) ?? null), externalId: id };
  }
  if (platform === "malt") {
    const link = links.find((candidate) => /malt\.(fr|com|de|es|be|nl|ch)\/(client-project|project|projects|messages|proposal|freelance-project)/i.test(candidate)) ?? null;
    const id = link?.match(/\/(?:client-project|projects?|messages|proposal|freelance-project)\/(?:[a-z-]+\/)?([a-z0-9-]{6,})/i)?.[1] ?? null;
    return { url: link?.split("?")[0] ?? null, externalId: id ? `malt:${id.toLowerCase()}` : null };
  }
  if (platform === "comeup") {
    const link = links.find((candidate) => /(comeup|5euros)\.com\/[^\s]*(order|commande|messages|conversation|demande)/i.test(candidate)) ?? null;
    const id = link?.match(/(?:orders?|commandes?|conversations?|demandes?)\/(\d{3,}|[a-z0-9-]{6,})/i)?.[1] ?? null;
    return { url: link?.split("?")[0] ?? null, externalId: id ? `comeup:${id.toLowerCase()}` : null };
  }
  if (platform === "codeur") {
    // L'identifiant du projet dans le lien est l'external_id du flux RSS (« /projects/490123-titre »).
    const link = links.find((candidate) => /codeur\.com\/projects\/\d+/i.test(candidate)) ?? null;
    const id = link?.match(/codeur\.com\/projects\/(\d+)/i)?.[1] ?? null;
    return { url: id && link ? link.split("?")[0].split("#")[0] : null, externalId: id };
  }
  return { url: null, externalId: null };
}

/** Titre entre guillemets dans le sujet (« "…" », « “…” », « « … » »), sinon après un deux-points. */
export function quotedTitle(subject: string): string | null {
  const quoted = subject.match(/["“«']\s?([^"”»]{4,200}?)\s?["”»']/);
  if (quoted) return quoted[1].trim();
  const afterColon = subject.match(/:\s*(.{4,200})$/);
  return afterColon ? afterColon[1].trim() : null;
}

const LABELED = (labels: string) => new RegExp(`^\\s*(?:${labels})\\s*[:：]\\s*(.+)$`, "im");

function labeled(body: string, labels: string): string | null {
  const match = body.match(LABELED(labels));
  // Le dernier groupe est la valeur (les libellés peuvent contenir leurs propres groupes).
  const value = match?.[match.length - 1];
  return value ? value.trim().slice(0, 300) : null;
}

/** Lignes de salutation (« Bonjour Axel, », « Hi Axel, ») : jamais un nom de client. */
const GREETING_LINE = /^(bonjour|bonsoir|hello|hi|hey|dear|cher|ch[eè]re)\b/i;

/** Un nom propre : majuscule initiale, puis lettres, points, apostrophes, espaces ou tirets. */
const NAME = String.raw`[A-ZÀ-Ý][\p{L}.'’ -]{1,40}?`;
const CLIENT_PATTERNS: Record<"en" | "fr", RegExp[]> = {
  en: [
    new RegExp(String.raw`^(${NAME})(?: \([^)]*\))? (?:has )?(?:invited you|sent you|messaged you|replied|responded|wants you|hired you)`, "u"),
    new RegExp(String.raw`(?:[Mm]essage|[Oo]ffer|[Ii]nvitation) from (${NAME})(?:\s+(?:about|for|regarding)\b|\s*[(:"“]|$)`, "u"),
  ],
  fr: [
    new RegExp(String.raw`^(${NAME})(?: \([^)]*\))? (?:souhaite|vous a (?:envoy|écrit|ecrit|contact|choisi|propos)|a (?:répondu|repondu|command|accept|pass))`, "u"),
    new RegExp(String.raw`(?:message|demande(?: de projet| de devis| personnalis[ée]e)?|commande|proposition de projet) de (?:la part de )?(${NAME})(?:\s+(?:pour|sur|concernant)\b|\s*[(:"«]|$)`, "u"),
  ],
};

/** Nom du client tel que l'e-mail le donne (« Jordan K. has invited you… », « Nouveau message de Claire Fontaine »). */
export function clientNameOf(platform: Platform | null, subject: string, body: string): string | null {
  const fromLabel = labeled(body, "client|de la part de|envoy[ée] par|acheteur|buyer");
  if (fromLabel && fromLabel.length <= 60) return fromLabel;
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !GREETING_LINE.test(line))
    .slice(0, 10);
  const patterns = CLIENT_PATTERNS[platform === "upwork" ? "en" : "fr"];
  for (const pattern of patterns) {
    for (const candidate of [subject.trim(), ...lines]) {
      // « Bonne nouvelle ! Sophie M. a commandé… » : l'exclamation d'ouverture n'est pas le nom.
      const match = candidate.replace(/^(bonne nouvelle|f[ée]licitations|congratulations|great news)\s*!\s*/i, "").match(pattern);
      const name = match?.[1].trim();
      if (name && name.length <= 60 && !/^(you|vous|upwork|malt|comeup|bonne nouvelle)$/i.test(name)) return name;
    }
  }
  return null;
}

export function budgetOf(body: string): string | null {
  const labeledBudget = labeled(body, "budget|fixed[- ]price|hourly( range)?|tarif|tjm|prix|montant|price");
  if (labeledBudget) return labeledBudget.slice(0, 120);
  const usd = body.match(/\$\s?\d[\d,]*(\.\d+)?(\s?(-|–|to)\s?\$?\s?\d[\d,]*(\.\d+)?)?(\s?\/\s?(hr|hour))?/i);
  if (usd) return usd[0].trim();
  const eur = body.match(/\d[\d\s.,]*\s?€(\s?(-|–|à)\s?\d[\d\s.,]*\s?€)?/);
  return eur ? eur[0].trim() : null;
}

/** Montant d'une commande ComeUp (« Montant : 120 € »). */
export function orderAmountEur(body: string): number | null {
  const match = body.match(/(?:montant|total|prix)[^\d\n]{0,20}(\d[\d\s.,]*)\s?€/i);
  if (!match) return null;
  const value = Number(match[1].replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Corps sans les pieds de page des plateformes (désinscription, adresse, mentions). */
export function mainContent(body: string): string {
  const cut = body.search(/\n\s*(unsubscribe|you are receiving this|vous recevez cet|se d[ée]sinscrire|g[ée]rer (mes|vos) (notifications|pr[ée]f[ée]rences)|manage (your )?(email|notification)|this email was sent|cet e-?mail (vous )?a [ée]t[ée] envoy|©|upwork global inc|malt community|comeup sas)/i);
  return (cut > 80 ? body.slice(0, cut) : body).trim();
}

/** Recommandations Upwork : une annonce par lien de job distinct (10 au plus). */
export function recommendedJobs(email: Pick<InboundEmail, "text" | "html">, body: string): EmailJob[] {
  const jobs = new Map<string, EmailJob>();
  // HTML : le texte de l'ancre est le titre.
  for (const match of email.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = decodeEntities(match[1]);
    try {
      href = decodeURIComponent(href);
    } catch {
      /* lien laissé tel quel */
    }
    const id = href.match(UPWORK_JOB_ID)?.[0].toLowerCase();
    const title = htmlToText(match[2]).replace(/\s+/g, " ").trim();
    if (!id || jobs.has(id) || title.length < 6 || /^(view|apply|see|submit|voir)\b/i.test(title)) continue;
    jobs.set(id, { title: title.slice(0, 300), url: `https://www.upwork.com/jobs/${id}`, externalId: id, budget: null, snippet: "" });
  }
  // Texte : le titre est la ligne non vide qui précède le lien ; l'extrait, les lignes qui suivent.
  const lines = body.split("\n");
  lines.forEach((line, index) => {
    const id = line.match(UPWORK_JOB_ID)?.[0].toLowerCase();
    if (!id) return;
    const previous = lines.slice(0, index).reverse().find((candidate) => candidate.trim() && !/https?:\/\//.test(candidate));
    const following = lines.slice(index + 1, index + 6).filter((candidate) => candidate.trim() && !/https?:\/\//.test(candidate));
    const existing = jobs.get(id);
    const snippet = following.join(" ").slice(0, 400);
    if (existing) {
      existing.snippet ||= snippet;
      existing.budget ||= budgetOf(following.join("\n"));
    } else if (previous && previous.trim().length >= 6) {
      jobs.set(id, { title: previous.trim().slice(0, 300), url: `https://www.upwork.com/jobs/${id}`, externalId: id, budget: budgetOf(following.join("\n")), snippet });
    }
  });
  return [...jobs.values()].slice(0, 10);
}

export function parsePlatformEmail(email: InboundEmail): ParsedEmail {
  const platform = platformOfSender(email.from);
  const body = mainContent(emailText(email));
  const kind = kindOf(platform, email.subject, body);
  const links = emailLinks(email);
  const { url, externalId } = platform ? platformLink(platform, links) : { url: null, externalId: null };
  const title =
    labeled(body, "job|job title|projet|project|titre|mission|service|annonce|intitul[ée]") ??
    quotedTitle(email.subject) ??
    (email.subject.trim() || null);
  return {
    platform,
    kind,
    title: title ? title.slice(0, 300) : null,
    url,
    externalId,
    clientName: platform ? clientNameOf(platform, email.subject, body) : null,
    budget: budgetOf(body),
    amountEur: platform === "comeup" ? orderAmountEur(body) : null,
    body,
    jobs: platform === "upwork" && kind === "recommandation" ? recommendedJobs(email, body) : [],
  };
}
