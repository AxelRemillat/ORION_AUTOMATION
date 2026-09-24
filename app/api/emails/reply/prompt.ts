import { personaBlock } from "@/lib/persona";
import type { InboundMessage, Message, Prospect } from "@/types";
import { buildContext } from "../generate/prompt";

/**
 * Prompt de RÉPONSE à un email entrant.
 *
 * Différent d'un mail à froid : l'interlocuteur a déjà écrit. Le travail n'est
 * plus d'accrocher mais de répondre — à ce qu'il demande, dans le fil, sans
 * re-dérouler l'argumentaire. La voix reste celle de `lib/persona`, partagée
 * avec la génération à froid pour qu'Axel ne change pas de ton entre deux
 * messages de la même conversation.
 */

/** Consigne propre à chaque catégorie : on ne répond pas pareil à un refus. */
const CATEGORY_GUIDANCE: Record<string, string> = {
  reponse:
    "Il a répondu à ta prise de contact. Rebondis sur ce qu'il dit précisément, " +
    "et propose l'étape suivante la plus simple possible.",
  question:
    "Il pose une question. Réponds-y DIRECTEMENT et en premier, avant toute autre " +
    "chose. Si tu n'as pas l'information, dis-le franchement plutôt que de broder.",
  relance:
    "Il relance ou s'impatiente. Va droit au but, sans t'excuser longuement, " +
    "et donne une réponse concrète.",
  refus:
    "C'est un refus. Sois bref et élégant : tu remercies, tu n'insistes pas, tu " +
    "laisses la porte ouverte en une phrase. AUCUNE relance déguisée, aucune " +
    "tentative de retourner l'objection.",
  autre: "Réponds simplement à ce qui est écrit, sans sur-interpréter.",
};

export function buildReplySystemPrompt(category: string): string {
  return `Tu réponds à un email A LA PLACE d'Axel. Tu n'es pas un assistant qui
rédige pour lui : tu es lui. Première personne, sa voix.

${personaBlock()}

LA SITUATION
${CATEGORY_GUIDANCE[category] ?? CATEGORY_GUIDANCE.autre}

LA VOIX
- Humain, chaleureux, direct. Quelqu'un qui écrit à quelqu'un.
- Des nuances quand tu avances quelque chose que tu ne sais pas de l'intérieur
  (« il me semble », « d'après ce que je comprends »).
- Zéro jargon, zéro formule creuse : ni « je me permets de revenir vers vous »,
  ni « j'espère que vous allez bien », ni « solution innovante ».
- Pas d'emoji, pas de markdown, aucun crochet à compléter.

RÈGLES DE LA RÉPONSE
- Tu réponds DANS une conversation en cours : pas de re-présentation complète,
  il sait déjà qui tu es.
- Moins de 150 mots. Une réponse courte vaut mieux qu'une réponse complète.
- N'invente AUCUN fait : ni chiffre, ni référence client, ni engagement de
  délai ou de prix que le fil ne contient pas déjà.
- Termine par une seule question ou une seule proposition d'étape suivante.
- Signature : « ${"Axel"} » seul, sur la dernière ligne.

Réponds UNIQUEMENT avec un objet JSON :
{ "subject": "objet du mail", "body": "corps de la réponse" }
L'objet reprend celui du fil en le préfixant de « Re : » s'il n'y est pas déjà.`;
}

/** Une entrée du fil, quel que soit son sens. */
interface ThreadEntry {
  at: number;
  who: "moi" | "lui";
  subject: string | null;
  body: string;
}

/** Fil complet, remis dans l'ordre chronologique. */
export function buildThread(messages: Message[], inbounds: InboundMessage[]): ThreadEntry[] {
  const sent: ThreadEntry[] = messages
    .filter((message) => message.status === "sent")
    .map((message) => ({
      at: Date.parse(message.sent_at ?? message.created_at),
      who: "moi" as const,
      subject: message.subject,
      body: message.body,
    }));

  const received: ThreadEntry[] = inbounds.map((inbound) => ({
    at: Date.parse(inbound.received_at),
    who: "lui" as const,
    subject: inbound.subject,
    body: inbound.body,
  }));

  return [...sent, ...received].sort((a, b) => a.at - b.at);
}

/**
 * Contexte remis au modèle : les faits vérifiés sur l'entreprise, puis le fil.
 *
 * Le contexte prospect vient du même constructeur que la génération à froid —
 * il distingue déjà ce qui est connu de ce qui ne l'est pas, ce qui évite au
 * modèle de combler les trous.
 */
export function buildReplyContext(
  prospect: Prospect | null,
  thread: ThreadEntry[],
  answering: InboundMessage,
): string {
  const parts: string[] = [];

  parts.push(
    prospect
      ? buildContext(prospect)
      : `Aucune fiche entreprise pour cet expéditeur (${answering.from_email}). ` +
        `Ne suppose rien sur son activité.`,
  );

  if (thread.length) {
    const history = thread
      .map((entry) => {
        const label = entry.who === "moi" ? "MOI" : "LUI";
        const subject = entry.subject ? ` (objet : ${entry.subject})` : "";
        return `--- ${label}${subject}\n${entry.body.slice(0, 1500)}`;
      })
      .join("\n\n");
    parts.push(`FIL DE LA CONVERSATION, du plus ancien au plus récent :\n\n${history}`);
  }

  parts.push(
    `LE MESSAGE AUQUEL TU RÉPONDS (reçu le ${answering.received_at}) :\n` +
      `${answering.subject ? `Objet : ${answering.subject}\n` : ""}${answering.body.slice(0, 4000)}`,
  );

  return parts.join("\n\n");
}

export interface ReplyDraft {
  subject: string;
  body: string;
}

/** Valide la réponse du modèle ; renvoie null si elle est inexploitable. */
export function parseReplyDraft(raw: string, fallbackSubject: string | null): ReplyDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const body = typeof source.body === "string" ? source.body.trim() : "";
  if (!body) return null;

  const subject =
    typeof source.subject === "string" && source.subject.trim()
      ? source.subject.trim()
      : prefixRe(fallbackSubject);

  return { subject, body };
}

/** « Re : » n'est ajouté qu'une fois, quelle que soit la forme déjà présente. */
function prefixRe(subject: string | null): string {
  const base = subject?.trim();
  if (!base) return "Re : votre message";
  return /^re\s*:/i.test(base) ? base : `Re : ${base}`;
}
