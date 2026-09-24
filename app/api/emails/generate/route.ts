import { NextResponse } from "next/server";
import { getOpenAI, OPENAI_MODEL } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { findDecisionMaker, hasHunterKey } from "@/lib/enrichment/hunter";
import { fetchSiteContent, hasLinkupKey, type PageContent } from "@/lib/enrichment/linkup";
import { toDomain } from "@/lib/enrichment/http";
import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import { edges, maxSimilarity } from "@/lib/similarity";
import { coerceTone, type ToneKey } from "@/lib/tones";
import type { Prospect } from "@/types";
// Garde d'authentification partagée avec les routes /api/prospects.
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import {
  buildAnalysisContext,
  buildAnalysisPrompt,
  parseDeepAnalysis,
  type DeepAnalysis,
} from "./analysis";
import {
  buildContext,
  buildWritingPrompt,
  extractEuroAmounts,
  parseEmail,
  type Evidence,
  type GeneratedEmail,
} from "./prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Deux appels OpenAI plus une lecture de site : 60 s suffisent largement. */
export const maxDuration = 90;

/** Au-delà, le brouillon ressemble trop à un précédent : on régénère une fois. */
const SIMILARITY_LIMIT = 0.4;

/** Nombre de mails précédents examinés pour l'anti-répétition. */
const HISTORY = 10;

interface GenerateBody {
  prospectId?: string;
  tone?: string;
  /**
   * Piste imposée par l'utilisateur, choisie parmi celles que l'analyse a
   * écartées. Permet de régénérer sous un autre angle sans tout relancer.
   */
  trackIndex?: number;
}

/**
 * Garde-fou anti-chiffres inventés : tout montant en euros du brouillon doit
 * correspondre à une donnée réellement collectée. On ne réécrit pas le texte
 * du modèle — on prévient l'utilisateur, qui relit avant d'envoyer.
 */
function checkEuroClaims(prospect: Prospect, body: string): EnrichmentWarning | null {
  const figures = prospect.key_figures ?? {};
  const known = new Set(
    [figures.revenue_eur, figures.net_income_eur, figures.capital_eur]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((value) => Math.round(value)),
  );

  const unknown = extractEuroAmounts(body).filter((amount) => !known.has(amount));
  if (!unknown.length) return null;

  return {
    source: "openai",
    message:
      `Montant non vérifié dans le brouillon (${unknown.join(", ")} EUR) : ` +
      "aucune donnée collectée ne le corrobore. Retirez-le ou corrigez-le avant envoi.",
  };
}

/** Lecture du site officiel — best effort, jamais bloquante. */
async function readSite(
  prospect: Prospect,
): Promise<{ pages: PageContent[]; warning?: EnrichmentWarning }> {
  if (!prospect.website) return { pages: [] };
  if (!hasLinkupKey()) {
    return {
      pages: [],
      warning: { source: "linkup", message: "clé absente : site non lu, analyse moins précise" },
    };
  }
  try {
    return { pages: await fetchSiteContent(prospect.website, prospect.id) };
  } catch {
    return {
      pages: [],
      warning: { source: "linkup", message: "site illisible : analyse fondée sur le NAF seul" },
    };
  }
}

/** Recherche du décideur — best effort, jamais bloquante. */
async function findContact(
  prospect: Prospect,
): Promise<{ contact: DecisionMakerContact | null; warning?: EnrichmentWarning }> {
  const domain = toDomain(prospect.website);
  if (!domain) {
    return { contact: null, warning: { source: "hunter", message: "aucun site connu pour ce prospect" } };
  }
  if (!hasHunterKey()) {
    return { contact: null, warning: { source: "hunter", message: "clé absente : email du décideur non recherché" } };
  }

  const leader = typeof prospect.key_figures?.leader === "string" ? prospect.key_figures.leader : null;
  const result = await findDecisionMaker(domain, leader, prospect.id);
  if (!result.ok) return { contact: null, warning: { source: "hunter", message: result.error } };
  return { contact: result.data };
}

/** ÉTAPE 1 — comprendre le métier. Température basse : on veut de la rigueur. */
async function runDeepAnalysis(
  prospect: Prospect,
  pages: PageContent[],
): Promise<DeepAnalysis | null> {
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildAnalysisPrompt(prospect) },
      { role: "user", content: buildAnalysisContext(prospect, pages, buildContext(prospect)) },
    ],
  });

  if (completion.usage) {
    await recordOpenAiUsage({
      model: OPENAI_MODEL,
      promptTokens: completion.usage.prompt_tokens ?? 0,
      completionTokens: completion.usage.completion_tokens ?? 0,
      operation: "analyse-metier",
      prospectId: prospect.id,
    });
  }
  return parseDeepAnalysis(completion.choices[0]?.message?.content ?? "");
}

/** ÉTAPE 2 — écrire. Température haute : c'est là qu'on veut de la variété. */
async function runWriting(
  prospect: Prospect,
  analysis: DeepAnalysis,
  tone: ToneKey,
  avoid: string[],
): Promise<GeneratedEmail | null> {
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.85,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildWritingPrompt({ tone, analysis, avoid, seed: prospect.company_name }) },
      { role: "user", content: `Écris le mail pour ${prospect.company_name}.` },
    ],
  });

  if (completion.usage) {
    await recordOpenAiUsage({
      model: OPENAI_MODEL,
      promptTokens: completion.usage.prompt_tokens ?? 0,
      completionTokens: completion.usage.completion_tokens ?? 0,
      operation: `redaction:${tone}`,
      prospectId: prospect.id,
    });
  }
  return parseEmail(completion.choices[0]?.message?.content ?? "");
}

/** Déplace la piste choisie en tête : l'étape 2 écrit toujours sur `tracks[0]`. */
function applyTrackChoice(analysis: DeepAnalysis, index?: number): DeepAnalysis {
  if (index === undefined || index <= 0 || index >= analysis.tracks.length) return analysis;
  const chosen = analysis.tracks[index];
  return {
    ...analysis,
    tracks: [chosen, ...analysis.tracks.filter((_, position) => position !== index)],
    pain_point: chosen.label,
    pourquoi_lui: chosen.why || analysis.pourquoi_lui,
  };
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const body = await readJson<GenerateBody>(request);
  if (!body?.prospectId) {
    return NextResponse.json({ error: "Prospect manquant." }, { status: 400 });
  }
  const tone = coerceTone(body.tone);

  const { data: prospect, error } = await session.supabase
    .from("prospects")
    .select("*")
    .eq("id", body.prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY absente : la génération est indisponible. Voir .env.local.example." },
      { status: 503 },
    );
  }

  // Lecture du site, contact et historique en parallèle : aucun ne dépend des
  // autres, et la latence ne doit pas s'additionner.
  const [siteOutcome, contactOutcome, historyResult] = await Promise.all([
    readSite(prospect),
    findContact(prospect).catch(() => ({ contact: null, warning: undefined })),
    session.supabase
      .from("messages")
      .select("body")
      .eq("type", "intro")
      .order("created_at", { ascending: false })
      .limit(HISTORY),
  ]);

  const warnings: EnrichmentWarning[] = [];
  if (siteOutcome.warning) warnings.push(siteOutcome.warning);
  if (contactOutcome.warning) warnings.push(contactOutcome.warning);

  let analysis: DeepAnalysis | null;
  try {
    analysis = await runDeepAnalysis(prospect, siteOutcome.pages);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "inconnue";
    return NextResponse.json({ error: `Analyse impossible : ${reason}` }, { status: 502 });
  }
  if (!analysis) {
    return NextResponse.json({ error: "Analyse inexploitable." }, { status: 502 });
  }
  analysis = applyTrackChoice(analysis, body.trackIndex);

  if (!analysis.specific) {
    warnings.push({
      source: "openai",
      message:
        "Aucune donnée ne permettait un diagnostic spécifique : le mail reste générique. " +
        "Renseignez le site du prospect ou relancez une recherche de signaux.",
    });
  }

  // Anti-répétition : on interdit explicitement les ouvertures et fins déjà
  // servies, puis on VÉRIFIE le résultat plutôt que de faire confiance.
  const previous = (historyResult.data ?? []).map((row) => (row as { body: string }).body);
  const avoid = previous.flatMap((text) => {
    const { opening, closing } = edges(text);
    return [opening, closing].filter(Boolean);
  });

  let email: GeneratedEmail | null;
  let similarity = 0;
  try {
    email = await runWriting(prospect, analysis, tone, avoid);
    if (email) {
      similarity = maxSimilarity(email.body, previous);
      if (similarity > SIMILARITY_LIMIT) {
        // Une seule reprise : deux appels suffisent, un troisième coûterait
        // plus qu'il ne rapporte.
        const retry = await runWriting(prospect, analysis, tone, [...avoid, edges(email.body).opening]);
        if (retry) {
          const retrySimilarity = maxSimilarity(retry.body, previous);
          if (retrySimilarity < similarity) {
            email = retry;
            similarity = retrySimilarity;
          }
        }
      }
    }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "inconnue";
    return NextResponse.json({ error: `Rédaction impossible : ${reason}` }, { status: 502 });
  }
  if (!email) {
    return NextResponse.json({ error: "Brouillon inexploitable." }, { status: 502 });
  }

  if (similarity > SIMILARITY_LIMIT) {
    warnings.push({
      source: "openai",
      message: `Ce brouillon ressemble à ${Math.round(similarity * 100)} % à un mail déjà envoyé. Relisez-le de près.`,
    });
  }

  const contact = contactOutcome.contact;
  if (contact && !prospect.email) {
    await session.supabase.from("prospects").update({ email: contact.email }).eq("id", prospect.id);
  }

  const euroWarning = checkEuroClaims(prospect, email.body);
  if (euroWarning) warnings.push(euroWarning);

  // `evidence` reste le contrat attendu par l'écran : on le construit depuis
  // l'analyse, dont chaque élément est adossé à une donnée réelle.
  const evidence: Evidence[] = [
    { label: "Modèle économique", value: analysis.business_model, source: "Analyse du site et du NAF" },
    { label: "Pourquoi eux", value: analysis.pourquoi_lui, source: analysis.proof_url ?? "Données collectées" },
    { label: "Détail unique", value: analysis.detail_unique, source: "Site officiel / signaux" },
  ].filter((item) => item.value);

  return NextResponse.json({
    pain_point: analysis.pain_point,
    evidence,
    email,
    analysis,
    contact,
    warnings,
  });
}
