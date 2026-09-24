/**
 * Registres de rédaction.
 *
 * Source unique, partagée par le sélecteur de l'écran Prospection et par la
 * route de génération. Ce sont des VARIATIONS d'une même voix — celle d'Axel —
 * pas quatre personnalités différentes : on change le débit, jamais l'identité.
 *
 * Module sans dépendance : importable côté serveur comme côté client.
 */

export const TONES = [
  {
    key: "direct",
    label: "Direct",
    hint: "Phrases courtes, une seule demande.",
    /** Consigne ajoutée au prompt quand ce registre est choisi. */
    instruction:
      "Phrases courtes, une idée par phrase. Une seule demande à la fin. " +
      "Tu vas droit au fait sans être sec : on doit sentir quelqu'un qui " +
      "respecte le temps du lecteur.",
  },
  {
    key: "chaleureux",
    label: "Chaleureux",
    hint: "Plus humain, un peu de contexte.",
    instruction:
      "Un peu plus de chaleur : une phrase qui montre que tu as regardé ce " +
      "qu'ils font, un mot sur pourquoi ça t'a accroché. Tu restes sobre, " +
      "jamais flatteur ni familier.",
  },
  {
    key: "factuel",
    label: "Factuel",
    hint: "Faits d'abord, zéro superlatif.",
    instruction:
      "Tu ouvres sur le fait vérifiable, sans emballage. Aucun superlatif, " +
      "aucun adjectif d'enthousiasme. Les nuances restent (« il me semble », " +
      "« pourrait ») : la sobriété n'autorise pas à affirmer plus.",
  },
  {
    key: "bref",
    label: "Ultra-court",
    hint: "Cinq lignes maximum.",
    instruction:
      "Cinq lignes maximum, 70 mots grand maximum. Tu gardes la présentation " +
      "en une ligne, l'hypothèse, le lien. Tu coupes tout le reste.",
  },
] as const;

export type ToneKey = (typeof TONES)[number]["key"];

export const DEFAULT_TONE: ToneKey = "direct";

const KEYS = TONES.map((tone) => tone.key) as readonly string[];

/** Valide une valeur venue du client ; retombe sur le registre par défaut. */
export function coerceTone(value: unknown): ToneKey {
  return typeof value === "string" && KEYS.includes(value)
    ? (value as ToneKey)
    : DEFAULT_TONE;
}

/** Consigne de rédaction correspondant au registre. */
export function toneInstruction(tone: ToneKey): string {
  return (TONES.find((item) => item.key === tone) ?? TONES[0]).instruction;
}
