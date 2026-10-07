import { UPWORK_MAX_CHARS } from "./platforms";

/**
 * CHECK-LIST ANGLAISE (Upwork) — la grille du « client exigeant » d'Axel
 * (buildClientJudgePrompt, 8 points), traduite et adaptée à Upwork : aperçu
 * de la 1re phrase, 1 200 caractères, prix fixe OU horaire en dollars.
 *
 * Écrite comme une CONFIGURATION, pas comme un moteur : le moteur de
 * check-list d'agent2 (#32) n'est pas encore sur main. Quand il y sera, ces
 * 8 points s'y branchent tels quels (id, libellé, consigne) ; en attendant,
 * le juge client les lit pour les propositions Upwork.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  rule: string;
}

export interface ChecklistConfig {
  id: string;
  language: "en" | "fr";
  /** Un point manqué plafonne la note à… */
  oneMissCap: number;
  twoMissCap: number;
  items: readonly ChecklistItem[];
}

export const UPWORK_CHECKLIST: ChecklistConfig = {
  id: "upwork-en",
  language: "en",
  oneMissCap: 8,
  twoMissCap: 6,
  items: [
    { id: "hook", label: "Hook in the preview", rule: "The FIRST sentence (the only one I see in the list) names MY concrete problem or outcome, with my tools or volumes — no « Hello », no « I am… », no self-introduction." },
    { id: "asked", label: "Every request answered", rule: "Every item I asked for (approach, price, timeline, examples, questions in the post…) gets an explicit answer, in the order I asked." },
    { id: "approach", label: "Concrete approach", rule: "A concrete approach in 3 steps, fitted to my tools and constraints — not generic steps (« discuss », « test »)." },
    { id: "proof", label: "Closest proof, honest", rule: "The closest proof to my need (a working demo of a similar case); honest about what has not been done yet; nothing invented — no fake clients, no made-up results." },
    { id: "price", label: "One price, one timeline", rule: "ONE price — a fixed amount OR an hourly rate, in US dollars — and ONE timeline, consistent with my budget and with a freelancer who is new on Upwork." },
    { id: "question", label: "One useful question", rule: "One scoping question that moves MY project forward (volume, tool, format), never generic (« when can we start? »)." },
    { id: "short", label: "Short and clean", rule: `Short: ${UPWORK_MAX_CHARS.toLocaleString("en-US")} characters at most, signed « Axel Remillat », no email, phone, calendar link or invitation to talk off Upwork.` },
    { id: "tone", label: "Plain, direct English", rule: "Plain, direct English: no flattery, no jargon (leverage, seamless, cutting-edge…), no « I'm passionate »." },
  ],
};

/** Consigne du juge client, rendue depuis la configuration. */
export function renderChecklist(config: ChecklistConfig): string {
  return `${config.items.map((item, index) => `${index + 1}. ${item.rule}`).join("\n")}
Missing one point → ${config.oneMissCap} at most. Missing two → ${config.twoMissCap} at most. You are not lenient: you have 79 other proposals.`;
}
