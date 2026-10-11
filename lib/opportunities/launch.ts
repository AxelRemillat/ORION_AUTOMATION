import type { AskFn } from "@/lib/ai/chat";
import { contactFailures, FLATTERY, INVENTED_CLAIMS, PROPOSAL_JARGON, SHORTEN_ABOVE_CHARS, type ProposalOutcome } from "./proposal";
import { LAUNCH_REFERENCES } from "./calibration";
import { LAUNCH_DELAY, launchKind, launchPrice, plainText as plain } from "./lane";

/**
 * PROPOSITION DE MISSION DE LANCEMENT (Codeur, 11/10/2026) : prix fixe de lancement
 * (300 € sous 500 € de budget, sinon 400 €), délai annoncé (7 jours pour un site,
 * 3 semaines pour une application), contre un avis honnête. La catégorie elle-même
 * vit dans ./lane (code pur, importable côté client).
 */

export * from "./lane";

// --- Proposition de lancement -------------------------------------------------------

export interface LaunchParts {
  /** Reprise du besoin exact (1 à 2 phrases). */
  reading: string;
  /** Preuve honnête, facultative : RISE (startup EdTech d'Axel), ORION, démos du portfolio Codeur. */
  proof?: string;
  items: string[];
  /** Le cahier des charges dépasse clairement le budget : première version limitée + phase 2. */
  exceeds: boolean;
  phase2?: string;
  question: string;
}

export interface LaunchFrame {
  price: number;
  kind: "site" | "app";
  budget: string | null;
}

/** Phrase de prix imposée (prix fixe, délai, avis honnête). */
export function launchPriceSentence(frame: LaunchFrame): string {
  return `Je démarre sur Codeur : tarif de lancement de ${frame.price} € à prix fixe${frame.kind === "app" ? " pour cette première version" : ""}, livré en ${LAUNCH_DELAY[frame.kind].label}, en échange d'un avis honnête à la fin de la mission.`;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

export function assembleLaunchProposal(parts: LaunchParts, frame: LaunchFrame): string {
  const items = parts.items.map((item, index) => `${index + 1}. ${clean(item).replace(/^\d+[.)]\s*/, "")}`).join("\n");
  const lead = parts.exceeds ? "Votre cahier des charges complet dépasse ce budget. Je vous propose donc de démarrer par une première version solide :" : "Ce que je propose :";
  return [
    "Bonjour,",
    [clean(parts.reading), parts.proof ? clean(parts.proof) : null].filter(Boolean).join(" "),
    `${lead}\n${items}`,
    parts.exceeds && parts.phase2 ? clean(parts.phase2) : null,
    launchPriceSentence(frame),
    clean(parts.question),
    "Axel Remillat",
  ]
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

/** Preuves autorisées : rien d'autre que RISE, ORION et le portfolio Codeur. */
const OTHER_PROOF = /(j['’]ai (deja )?(cree|realise|developpe|livre|construit|fait)|mes (realisations|projets precedents)|pour (un|une|mes) clients?)/;

/**
 * CHECK-LIST de la proposition de lancement (code) : salutation, besoin repris, trois
 * points, prix fixe de lancement + délai + avis honnête, une seule question, aucune
 * URL ni coordonnée, signature « Axel Remillat », 980 caractères au plus, aucune
 * expérience inventée, phase 2 si le budget est dépassé.
 */
export function launchChecks(text: string, frame: LaunchFrame & { exceeds?: boolean }): string[] {
  const failures: string[] = [];
  const value = text.trim();
  if (!value.startsWith("Bonjour,")) failures.push("Commence par « Bonjour, ».");
  if (!/\nAxel Remillat$/.test(value)) failures.push("Signature : « Axel Remillat » seul, en dernière ligne.");
  if (value.length > SHORTEN_ABOVE_CHARS) failures.push(`${value.length} caractères : 980 au plus (message privé Codeur).`);
  failures.push(...contactFailures(value, "codeur"));
  const prices = plain(value);
  if (!/tarif de lancement/.test(prices) || !new RegExp(`${frame.price}\\s?€`).test(value) || !/prix fixe/.test(prices) || !/avis honnete/.test(prices)) {
    failures.push(`Phrase de lancement : « tarif de lancement de ${frame.price} € à prix fixe … en échange d'un avis honnête ».`);
  }
  if (!new RegExp(LAUNCH_DELAY[frame.kind].label.replace(" ", "\\s")).test(value)) failures.push(`Délai annoncé : ${LAUNCH_DELAY[frame.kind].label}.`);
  const items = value.match(/^\d\.\s/gm) ?? [];
  if (items.length < 3 || items.length > 4) failures.push(`${items.length} point(s) : trois points concrets.`);
  const questions = (value.match(/\?/g) ?? []).length;
  if (questions !== 1) failures.push(`${questions} question(s) : une seule question de cadrage.`);
  const invented = value.match(INVENTED_CLAIMS) ?? prices.match(OTHER_PROOF);
  if (invented) failures.push(`Expérience non prouvée (« ${invented[0]} ») : seulement RISE, ORION ou les démos du portfolio Codeur.`);
  const flattery = value.match(FLATTERY);
  if (flattery) failures.push(`Flatterie (« ${flattery[0]} »).`);
  const jargon = value.match(PROPOSAL_JARGON);
  if (jargon) failures.push(`Jargon (« ${jargon[0]} »).`);
  if (frame.exceeds && !/(phase 2|seconde phase|deuxieme phase|dans un second temps)/.test(prices)) failures.push("Cahier des charges au-delà du budget : une première version limitée, puis une phase 2 chiffrée à part.");
  if (/(tout|l'ensemble) (pour|a) \d+ ?€/.test(prices)) failures.push("Jamais « tout pour » le prix de lancement : première version, puis phase 2.");
  return failures;
}

export function buildLaunchPrompt(frame: LaunchFrame, feedback: string | null): string {
  const examples = LAUNCH_REFERENCES.map((item) => `--- ${item.title} (${item.budget}) ---\n${item.text}`).join("\n\n");
  return `Tu rédiges, à la place d'Axel Remillat, la réponse à une annonce Codeur de DÉVELOPPEMENT WEB. Axel démarre sur Codeur : il propose un TARIF DE LANCEMENT à prix fixe (${frame.price} €, livré en ${LAUNCH_DELAY[frame.kind].label}) en échange d'un avis honnête. Le code ajoute « Bonjour, », la phrase de prix, et la signature.

Tu écris en JSON :
- "reading" : 1 à 2 phrases qui reprennent le besoin EXACT du client, avec ses mots (« Vous voulez… »).
- "proof" : "" le plus souvent. SEULEMENT si c'est pertinent, une phrase honnête : RISE (la startup EdTech d'Axel, visible dans son portfolio Codeur) pour un projet éducatif, ou ORION (application web Next.js / Supabase qu'il a construite) pour une application. Rien d'autre, aucune expérience inventée.
- "items" : TROIS points concrets de ce qui sera livré (site responsive, pages, base SEO technique, espace d'édition, comptes, etc.), adaptés à l'annonce.
- "exceeds" : true si le cahier des charges dépasse CLAIREMENT ${frame.price} € (beaucoup de fonctionnalités : paiement, forum, multi-rôles…). Alors "items" = la PREMIÈRE VERSION limitée, et "phase2" = une phrase qui renvoie le reste en phase 2, chiffrée à part une fois la base validée. Jamais tout promettre pour ${frame.price} €.
- "question" : UNE question de cadrage (contenus, logo, nom de domaine, niche…), qui finit par « ? ».
INTERDITS : URL, e-mail, téléphone, flatterie, jargon, références inventées. Le tout fait 980 caractères au plus avec la phrase de prix et la signature.

PROPOSITIONS DE RÉFÉRENCE (validées par Axel ; imite la structure et le ton, n'en copie aucune phrase) :
${examples}${feedback ? `\n\nRÉÉCRITURE — corrige ces défauts :\n${feedback}` : ""}

Réponds UNIQUEMENT en JSON : {"reading":"…","proof":"","items":["…","…","…"],"exceeds":false,"phase2":"","question":"…"}`;
}

export function parseLaunchParts(raw: string): LaunchParts | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const items = Array.isArray(value.items) ? value.items.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    if (typeof value.reading !== "string" || !value.reading.trim() || typeof value.question !== "string" || items.length < 3) return null;
    return {
      reading: value.reading,
      proof: typeof value.proof === "string" ? value.proof : "",
      items: items.slice(0, 3),
      exceeds: value.exceeds === true,
      phase2: typeof value.phase2 === "string" ? value.phase2 : "",
      question: value.question,
    };
  } catch {
    return null;
  }
}

/** Proposition de lancement : un essai, une réécriture ciblée au plus ; le code pose prix, délai et signature. */
export async function generateLaunchProposal(input: { ask: AskFn; title: string; body: string; budget: string | null; need?: string | null }): Promise<ProposalOutcome | { error: string }> {
  const frame: LaunchFrame = { price: launchPrice(input.budget), kind: launchKind(`${input.title} ${input.body}`), budget: input.budget };
  let feedback: string | null = null;
  let best: { text: string; failures: string[] } | null = null;
  let attempts = 0;
  for (let round = 0; round < 2; round += 1) {
    attempts += 1;
    const raw = await input
      .ask("writer", buildLaunchPrompt(frame, feedback), `Annonce « ${input.title} » — budget : ${input.budget ?? "non indiqué"}.\n\n${input.body.slice(0, 5000)}${input.need ? `\n\nBesoin reformulé : ${input.need}` : ""}`, round ? 0.4 : 0.6, `opportunites:lancement${round ? ":rewrite" : ""}`)
      .catch(() => "");
    const parts = parseLaunchParts(raw);
    if (!parts) {
      feedback = 'La réponse n\'était pas le JSON demandé : {"reading","proof","items":[3],"exceeds","phase2","question"}.';
      continue;
    }
    const text = assembleLaunchProposal(parts, frame);
    const failures = launchChecks(text, { ...frame, exceeds: parts.exceeds });
    if (!best || failures.length < best.failures.length) best = { text, failures };
    if (!failures.length) break;
    feedback = failures.map((line) => `- ${line}`).join("\n");
  }
  if (!best) return { error: "Proposition de lancement inexploitable." };
  const ready = best.failures.length === 0;
  return {
    text: best.text,
    score: ready ? 9 : Math.max(5, 9 - best.failures.length),
    checklist: null,
    needsReview: !ready,
    reason: ready ? null : best.failures[0],
    attempts,
    amountEur: frame.price,
    delayDays: LAUNCH_DELAY[frame.kind].days,
    currency: "EUR",
    hourly: false,
  };
}
