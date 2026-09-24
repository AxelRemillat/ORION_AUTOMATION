/**
 * Registres de rédaction — ré-export de la source unique `@/lib/tones`.
 *
 * Les consignes de style vivent désormais à côté de la route de génération,
 * qui les applique réellement. Ce fichier ne subsiste que pour garder les
 * imports de l'écran Prospection stables.
 */
export { DEFAULT_TONE, TONES, coerceTone, toneInstruction, type ToneKey } from "@/lib/tones";
