/**
 * Registres de rédaction proposés avant génération.
 *
 * La clé choisie est transmise à `/api/emails/generate` (champ `tone`) : la
 * route l'ignore aujourd'hui, l'écran est prêt le jour où elle le lira. Rien
 * n'est transformé côté client — un brouillon affiché est toujours celui que
 * le modèle a réellement produit.
 */

export const TONES = [
  { key: "direct", label: "Direct", hint: "Phrases courtes, une seule demande." },
  { key: "chaleureux", label: "Chaleureux", hint: "Plus humain, un peu de contexte." },
  { key: "factuel", label: "Factuel", hint: "Chiffres d'abord, zéro superlatif." },
  { key: "bref", label: "Ultra-court", hint: "Cinq lignes maximum." },
] as const;

export type ToneKey = (typeof TONES)[number]["key"];

export const DEFAULT_TONE: ToneKey = "direct";
