import { OPT_OUT_SENTENCE } from "./opt-out";

/**
 * ORIGINE DES COORDONNÉES (Cowork #59) — la mention de fin dit d'où vient l'adresse, puis le « stop ».
 *
 * Une ligne, ton naturel, hors comptage de longueur (c'est la ligne d'opposition, lib/mail-preflight/opt-out.ts) :
 *   « Votre adresse figure sur votre site. Un simple « stop » en réponse et je ne vous écris plus. »
 *
 * La source est celle que le module contact a RÉELLEMENT utilisée (`contact_found_by`, `contact_source`) :
 * `site:*` → le site, `hunter:*` → l'annuaire Hunter, `reponse:*` → l'équipe qui l'a donnée. Source inconnue :
 * aucune origine inventée, la phrase d'opposition d'avant.
 */

export type ContactOrigin = "site" | "hunter" | "registre" | "reponse";

export const STOP_SENTENCE = "Un simple « stop » en réponse et je ne vous écris plus.";

const ORIGIN_SENTENCE: Record<ContactOrigin, string> = {
  site: "Votre adresse figure sur votre site.",
  hunter: "Votre adresse vient de l'annuaire professionnel Hunter.",
  registre: "Votre adresse vient de l'annuaire des entreprises.",
  reponse: "Votre adresse m'a été donnée par votre équipe.",
};

export function contactOriginOf(source: { contact_found_by?: string | null; contact_source?: string | null } | null | undefined): ContactOrigin | null {
  const by = `${source?.contact_found_by ?? ""} ${source?.contact_source ?? ""}`.toLowerCase();
  if (/(^|\s)hunter/.test(by)) return "hunter";
  if (/(^|\s)site:/.test(by)) return "site";
  if (/(^|\s)r[ée]ponse/.test(by)) return "reponse";
  if (/annuaire|registre|recherche-entreprises|sirene|pappers|inpi/.test(by)) return "registre";
  return null;
}

/** La ligne de fin : origine puis « stop » ; sans origine connue, la phrase d'opposition d'avant. */
export function optOutSentence(origin: ContactOrigin | null | undefined): string {
  return origin ? `${ORIGIN_SENTENCE[origin]} ${STOP_SENTENCE}` : OPT_OUT_SENTENCE;
}
