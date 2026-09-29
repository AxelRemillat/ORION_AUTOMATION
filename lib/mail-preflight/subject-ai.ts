import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeSubject, SUBJECT_MAX } from "./subject";
import { withoutSignature } from "./words";

/**
 * Les deux appels LLM de l'objet, sur le modèle bon marché (1 appel chacun) :
 *   - « cet objet correspond-il au corps ? » → oui/non + raison, mis en cache
 *     par empreinte objet + corps (un avertissement, jamais un blocage) ;
 *   - « propose un objet pour ce corps ».
 * `ask` est injecté : la route branche OpenAI, les tests un double.
 */

export const subjectModel = (env: Record<string, string | undefined> = process.env) =>
  env.OPENAI_MODEL_SUBJECT?.trim() || "gpt-6-luna";

export type SubjectAsk = (system: string, user: string) => Promise<string>;

export interface Coherence {
  coherent: boolean;
  reason: string;
}

/** Cache des verdicts : table `mail_subject_checks` en production, Map en test. */
export interface CoherenceCache {
  get(hash: string): Promise<Coherence | null>;
  set(hash: string, value: Coherence): Promise<void>;
}

export const coherenceHash = (subject: string, body: string) =>
  createHash("sha1").update(`${subject.trim().toLowerCase()}\n---\n${body.trim()}`).digest("hex");

const VERDICT = z.object({ coherent: z.boolean(), reason: z.string().default("") });

const COHERENCE_SYSTEM = `Tu relis un mail de prospection B2B avant envoi.
Question unique : l'OBJET annonce-t-il bien le sujet dont parle le CORPS ?
Un objet qui parle d'autre chose (ex. objet « suivi des expéditions » sur un corps qui parle de devis) est incohérent.
Réponds en JSON : {"coherent": true|false, "reason": "une phrase courte"}.`;

export async function checkCoherence(
  ask: SubjectAsk,
  input: { subject: string; body: string; signature?: string | null },
  cache?: CoherenceCache,
): Promise<Coherence> {
  const body = withoutSignature(input.body, input.signature);
  const hash = coherenceHash(input.subject, body);
  const cached = await cache?.get(hash).catch(() => null);
  if (cached) return cached;

  const raw = await ask(COHERENCE_SYSTEM, `OBJET : ${input.subject}\n\nCORPS :\n${body}`);
  let verdict: Coherence;
  try {
    const parsed = VERDICT.parse(JSON.parse(raw));
    verdict = { coherent: parsed.coherent, reason: parsed.reason.trim() || (parsed.coherent ? "cohérent" : "sujet différent") };
  } catch {
    // Réponse illisible : on ne bloque pas, on ne rassure pas non plus.
    return { coherent: true, reason: "vérification indisponible" };
  }
  await cache?.set(hash, verdict).catch(() => undefined);
  return verdict;
}

const PROPOSAL = z.object({ subject: z.string().min(1) });

const PROPOSE_SYSTEM = `Tu proposes l'OBJET d'un mail de prospection B2B, à partir de son corps.
- 2 à 7 mots, ${SUBJECT_MAX} caractères au plus, majuscule initiale, pas de point final, pas de « ! » ni d'emoji ;
- il nomme le sujet concret du corps (le processus dont parle le mail), pas une promesse ;
- jamais « Automatisation de… » ni le nom de l'entreprise.
Réponds en JSON : {"subject": "…"}.`;

export async function proposeSubject(ask: SubjectAsk, input: { body: string; signature?: string | null }): Promise<string | null> {
  const raw = await ask(PROPOSE_SYSTEM, `CORPS :\n${withoutSignature(input.body, input.signature)}`);
  try {
    const subject = normalizeSubject(PROPOSAL.parse(JSON.parse(raw)).subject);
    return subject.length <= SUBJECT_MAX ? subject : subject.slice(0, SUBJECT_MAX).replace(/\s+\S*$/, "");
  } catch {
    return null;
  }
}
