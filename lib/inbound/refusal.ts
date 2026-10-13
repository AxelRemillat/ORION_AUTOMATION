/**
 * REFUS DANS UNE RÉPONSE (Cowork #51, 13/10/2026). ARTFLEX a répondu
 * « Bonjour / Non / merci » : la fiche restait en relance. Règles d'abord, sur
 * le début du message SANS la citation ; le LLM ne tranche que l'ambigu
 * (lib/inbound/refusal-server.ts).
 *
 * PRUDENCE : « pas maintenant », « recontactez-moi en janvier », « envoyez-moi
 * plus d'infos », une question, une absence ou un anti-spam ne sont PAS des
 * refus. Dans le doute, rien ne change.
 */

export type RefusalKind =
  /** « stop », « ne plus me contacter », « désinscrire » : perdu + ne plus contacter. */
  | "stop"
  /** Refus clair : perdu, relances annulées. */
  | "refus"
  /** Intérêt différé : statut inchangé, date éventuelle. */
  | "plus_tard"
  /** Ni refus ni report sûrs : le LLM léger tranche. */
  | "ambigu"
  /** Rien qui ressemble à un refus. */
  | "autre";

/** Longueur lue, hors citation. */
export const REFUSAL_WINDOW = 300;

const norm = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

/**
 * Le message SANS la citation du mail d'origine : « -----Message d'origine----- »,
 * « Le … a écrit : », « On … wrote: », bloc « De : … Envoyé : … », lignes « > ».
 */
export function ownText(body: string): string {
  const lines = body.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^-{2,}\s*(message d'origine|original message|message transf)/i.test(t)) break;
    if (/^(le|on)\b.{0,120}(a ecrit|a écrit|wrote)\s*:?\s*$/i.test(t)) break;
    if (/^(de|from)\s*:.+/i.test(t) && out.length) break;
    if (/^_{5,}$/.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const STOP = /\b(stop|unsubscribe|desinscri\w*|desabonn\w*|ne (plus|pas) (me |nous )?(re)?contacter|ne plus (m'|nous )?(ecrire|envoyer)|retire[rz]? (moi|nous|mon adresse|notre adresse)|supprime[rz]? (moi|nous|mon adresse|notre adresse)|plus de (mail|message)s?\b)/;
const REFUS = [
  /^(bonjour|bonsoir|hello)?[ ,.!]*non[ ,.!]*(merci)?[ ,.!]*(cordialement|bonne journee)?[ ,.!]*$/,
  /\bnon,? merci\b/,
  /\bpas (du tout )?interess/,
  /\bne sommes pas interess/,
  /\bn'?(avons|ai) pas (besoin|l'utilite|d'interet)/,
  /\bpas (de|d'un) besoin\b/,
  /\baucun (besoin|interet)\b/,
  /\bne (donnerons|donnera|souhaitons|souhaite) pas (suite|donner suite)/,
  /\bpas donner suite\b/,
  /\bne (sommes|suis) pas (concerne|demandeur)/,
  /\bdeja (equipe|un prestataire|un fournisseur|en place)\b/,
  /\bpas pour nous\b/,
];
/** Report ou intérêt : ce n'est pas un refus, même avec un « non » dedans. */
const LATER = /\b(pas (pour )?(le moment|maintenant|tout de suite)|plus tard|recontacte[rz]?[- ]?(moi|nous)|revenir vers (moi|nous)|(en|a partir de|courant|debut|fin) (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|\d{4})|l'an(nee)? prochain|dans (quelques|\d+) (semaines|mois))/;
const INTEREST = /(\?|plus d'info|davantage d'info|en savoir plus|envoye[rz]?[- ](moi|nous)|appele[rz]?[- ](moi|nous)|rappele[rz]|quel (est le )?(tarif|prix|cout)|combien|rendez-vous|disponible|interess)/;

const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];

/** Mois de reprise annoncé (« recontactez-moi en janvier »), au 1er du mois, ou `null`. */
export function laterDate(text: string, now = new Date()): string | null {
  const t = norm(text);
  const index = MONTHS.findIndex((month) => new RegExp(`\\b(en|a partir de|courant|debut|fin|d'ici) ${month}\\b`).test(t));
  if (index < 0) return null;
  const year = index < now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return `${year}-${String(index + 1).padStart(2, "0")}-01`;
}

/** Classement par règles, sur les 300 premiers caractères hors citation. */
export function classifyRefusal(body: string): RefusalKind {
  const text = norm(ownText(body).slice(0, REFUSAL_WINDOW));
  if (!text) return "autre";
  if (STOP.test(text)) return "stop";
  if (LATER.test(text)) return "plus_tard";
  // « pas intéressé » n'est pas un signe d'intérêt : retiré avant la recherche.
  if (INTEREST.test(text.replace(/\bpas (du tout )?interess\w*/g, " "))) return "autre";
  if (REFUS.some((rule) => rule.test(text))) return "refus";
  // Court et négatif sans règle sûre (« Non. », « pas pour cette année ») : au LLM.
  if (text.length <= 160 && /\b(non|pas|aucun|jamais|inutile)\b/.test(text)) return "ambigu";
  return "autre";
}

/** Trace de refus d'une fiche (`key_figures.refusal`, posée par applyRefusal), ou `null`. */
export function refusalOf(figures: unknown): { kind: "refus" | "stop"; inbound_id: string } | null {
  const trace = (figures as { refusal?: { kind?: string; inbound_id?: string } } | null)?.refusal;
  return trace && (trace.kind === "refus" || trace.kind === "stop") && trace.inbound_id ? { kind: trace.kind, inbound_id: trace.inbound_id } : null;
}
