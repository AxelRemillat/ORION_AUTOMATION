/**
 * Encodage des pages lues — décodage correct, puis réparation du mojibake.
 *
 * Constat en prod : « FondÃ », « PyrÃ©nÃ©es », « Bordeauxâ€¯? ». C'est de
 * l'UTF-8 relu en Latin-1 / Windows-1252 : chaque caractère accentué (deux ou
 * trois octets en UTF-8) devient deux ou trois caractères occidentaux. Deux
 * origines :
 *
 *   1. le fetch direct : `response.text()` décode TOUJOURS en UTF-8 et ignore
 *      le charset annoncé ; une page réellement en ISO-8859-1 sort abîmée ;
 *   2. la source elle-même (Linkup, un CMS mal configuré) a déjà mal décodé :
 *      le texte arrive en mojibake, quel que soit notre décodage.
 *
 * D'où deux fonctions : `decodeBody` respecte l'en-tête HTTP, puis le <meta>,
 * puis UTF-8 par défaut ; `repairMojibake` réencode chaque séquence suspecte
 * en octets Windows-1252 et la relit en UTF-8 — la réparation n'est appliquée
 * que si ces octets forment de l'UTF-8 VALIDE, ce qui protège le texte sain.
 */

/** Octets 0x80-0x9F de Windows-1252 : les seuls qui diffèrent de Latin-1. */
const CP1252_HIGH: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91,
  "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98,
  "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
const HIGH = Object.keys(CP1252_HIGH).join("");

/**
 * Séquence UTF-8 vue en Windows-1252 : un octet de tête (Â-ô) suivi du bon
 * nombre d'octets de continuation (0x80-0xBF, soit Latin-1 ou les spéciaux
 * cp1252 ci-dessus).
 */
const CONT = `[\\u0080-\\u00BF${HIGH}]`;
const MOJIBAKE = new RegExp(
  `[\\u00C2-\\u00DF]${CONT}|[\\u00E0-\\u00EF]${CONT}{2}|[\\u00F0-\\u00F4]${CONT}{3}`,
  "g",
);

/** Indices qui trahissent le mojibake ; absents du français correctement encodé. */
const SUSPECT = /Ã|Â|â€|Å[“’]/;

function toByte(char: string): number | null {
  const code = char.charCodeAt(0);
  if (code <= 0xff) return code;
  return CP1252_HIGH[char] ?? null;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Relit une séquence en UTF-8 ; `null` si ce n'était pas du mojibake. */
function reinterpret(sequence: string): string | null {
  const bytes: number[] = [];
  for (const char of sequence) {
    const byte = toByte(char);
    if (byte == null) return null;
    bytes.push(byte);
  }
  try {
    return strictUtf8.decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/**
 * Traces laissées quand le 2e octet a été PERDU avant nous : « © » (é) et
 * « ® » (î) sont des pictogrammes que le nettoyage retirait, et l'espace
 * insécable (à) finit normalisé en espace. Il reste un « Ã » orphelin.
 * « Ã » n'existe pas en français : on restitue la lettre la plus probable.
 */
function repairOrphans(text: string): string {
  return (
    text
      // « FondÃ e » : le « © » est devenu une espace, la fin du mot est détachée.
      .replace(/(\p{L})Ã[ \u00A0](?=(?:e|es|s|ee|ees)\b)/gu, "$1é")
      // « Ã Paris » : mot isolé = préposition « à ».
      .replace(/(^|[\s(«"'’])Ã(?=[\s\u00A0]|$)/gu, "$1à")
      // « FondÃ » en fin de mot : participe en -é, de loin le cas le plus courant.
      .replace(/(\p{L})Ã(?=[\s\u00A0\p{P}]|$)/gu, "$1é")
  );
}

/**
 * Répare le mojibake UTF-8→Latin-1/cp1252, y compris doublement encodé.
 * Idempotent : un texte sain ou déjà réparé est rendu inchangé.
 */
export function repairMojibake(text: string): string {
  if (!text || !SUSPECT.test(text)) return text;
  let current = text;
  // Deux passes au plus : couvre un double encodage (« ÃƒÂ© »).
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.replace(MOJIBAKE, (sequence) => reinterpret(sequence) ?? sequence);
    if (next === current) break;
    current = next;
  }
  return SUSPECT.test(current) ? repairOrphans(current) : current;
}

/** `true` si le texte porte encore des traces de mojibake. */
export function hasMojibake(text: string): boolean {
  return SUSPECT.test(text);
}

// ---------------------------------------------------------------------------
// Décodage d'une réponse HTTP
// ---------------------------------------------------------------------------

/** Charset d'un en-tête Content-Type (`text/html; charset=ISO-8859-1`). */
export function charsetFromContentType(contentType: string | null | undefined): string | null {
  const match = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? "");
  return match ? match[1].toLowerCase() : null;
}

/** Charset déclaré dans le HTML : `<meta charset>` ou `http-equiv`, 2 Ko de tête. */
export function charsetFromMeta(head: string): string | null {
  const direct = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  return direct ? direct[1].toLowerCase() : null;
}

/** Décodeur pour un label ; `null` si Node ne le connaît pas. */
function decoderFor(label: string): TextDecoder | null {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
}

/**
 * Décode un corps de réponse. Ordre : BOM, en-tête HTTP, <meta>, puis UTF-8.
 * Un UTF-8 annoncé mais invalide (page réellement en Latin-1) retombe sur
 * Windows-1252 plutôt que de semer des « � ». Le mojibake hérité de la
 * source est réparé au passage.
 */
export function decodeBody(buffer: ArrayBuffer | Uint8Array, contentType?: string | null): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let label: string | null = null;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = "utf-8";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";

  label ??= charsetFromContentType(contentType);
  // Le <meta> est ASCII : une lecture Latin-1 de la tête suffit à le trouver.
  label ??= charsetFromMeta(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)));

  const decoder = (label && decoderFor(label)) || new TextDecoder("utf-8");
  let text: string;
  if (decoder.encoding === "utf-8") {
    try {
      text = strictUtf8.decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
  } else {
    text = decoder.decode(bytes);
  }
  return repairMojibake(text.replace(/^﻿/, ""));
}

/**
 * Répare toutes les chaînes d'une valeur JSON (objets et tableaux imbriqués).
 * Sert au rattrapage des données déjà en base : `changed` compte les chaînes
 * modifiées, 0 sur une valeur saine — d'où l'idempotence du script.
 */
export function repairValue(value: unknown): { value: unknown; changed: number } {
  if (typeof value === "string") {
    const repaired = repairMojibake(value);
    return { value: repaired, changed: repaired === value ? 0 : 1 };
  }
  if (Array.isArray(value)) {
    let changed = 0;
    const items = value.map((item) => {
      const result = repairValue(item);
      changed += result.changed;
      return result.value;
    });
    return { value: changed ? items : value, changed };
  }
  if (value && typeof value === "object") {
    let changed = 0;
    const entries = Object.entries(value).map(([key, item]) => {
      const result = repairValue(item);
      changed += result.changed;
      return [key, result.value] as const;
    });
    return { value: changed ? Object.fromEntries(entries) : value, changed };
  }
  return { value, changed: 0 };
}
