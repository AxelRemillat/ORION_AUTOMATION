import { OPT_OUT_SENTENCE, hasOptOut, withoutOptOut } from "@/lib/mail-preflight/opt-out";

/**
 * Corps d'un mail : la partie qu'on écrit, et la partie qu'on ne touche pas.
 *
 * Le brouillon stocké embarque la mention « stop » et la signature, posées par
 * le code (lib/mail-preflight/opt-out.ts, lib/offer/model.ts). Dans
 * « Aujourd'hui », elles s'affichent en lignes VERROUILLÉES, hors du champ
 * éditable : une retouche du texte ne peut ni les effacer ni les dupliquer, et
 * elles ne comptent pas dans le plafond de mots.
 *
 * À l'enregistrement, on recompose : le texte édité, puis la mention si le
 * brouillon la portait, puis la signature. La mention est réécrite dans sa
 * forme canonique (`OPT_OUT_SENTENCE`), source unique du générateur.
 */

export interface SplitBody {
  /** Ce que l'éditeur montre et que l'utilisateur modifie. */
  core: string;
  optOut: boolean;
  /** Bloc de signature reconnu, ou `null` s'il n'est pas en fin de corps. */
  signature: string | null;
}

/** Découpe un corps stocké. `signature` est le bloc attendu (offre en cours). */
export function splitBody(body: string, signature?: string | null): SplitBody {
  let rest = (body ?? "").replace(/\r\n/g, "\n").trimEnd();
  const sign = (signature ?? "").trim();
  let found: string | null = null;
  if (sign && rest.endsWith(sign)) {
    found = sign;
    rest = rest.slice(0, rest.length - sign.length).trimEnd();
  }
  const optOut = hasOptOut(rest);
  const core = optOut ? withoutOptOut(rest) : rest;
  return { core: core.replace(/\n{3,}/g, "\n\n").trimEnd(), optOut, signature: found };
}

/** Recompose le corps à enregistrer à partir du texte édité. */
export function joinBody(core: string, parts: { optOut: boolean; signature: string | null }): string {
  const blocks = [(core ?? "").replace(/\r\n/g, "\n").trimEnd()];
  if (parts.optOut) blocks.push(OPT_OUT_SENTENCE);
  if (parts.signature) blocks.push(parts.signature.trim());
  return blocks.filter(Boolean).join("\n\n");
}
