import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAI, OPENAI_MODEL } from "@/lib/openai";
import { recordOpenAiUsage } from "@/lib/usage/record";
import {
  fetchQuota,
  findDecisionMaker,
  findEmailByName,
  hasHunterKey,
} from "@/lib/enrichment/hunter";
import { fetchSiteContent, hasLinkupKey, type PageContent } from "@/lib/enrichment/linkup";
import { toDomain } from "@/lib/enrichment/http";
import type { DecisionMakerContact, EnrichmentWarning } from "@/lib/enrichment/types";
import { buildFacts, type DerivedFact } from "@/lib/emails/derived-facts";
import { PERSONA } from "@/lib/persona";
import { validateEmail } from "@/lib/emails/validate";
import { describesNeed, needConfidence } from "@/lib/emails/need-lead";
import { edges, maxSimilarity } from "@/lib/similarity";
import { coerceTone, type ToneKey } from "@/lib/tones";
import type { Prospect } from "@/types";
import { readJson, requireSession } from "@/app/api/prospects/_guard";
import {
  ANALYSIS_SCHEMA,
  buildAnalysisContext,
  buildAnalysisPrompt,
  isGenericAnalysis,
  runAnalysisWithRetry,
  type DeepAnalysis,
} from "./analysis";
import {
  buildWritingPrompt,
  parseEmail,
  planFor,
  type Evidence,
  type GeneratedEmail,
} from "./prompt";
import {
  averageScore,
  buildCriticContext,
  buildCriticPrompt,
  failingCriteria,
  parseCritique,
  type Critique,
} from "./critic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Analyse + rédaction + juge, et jusqu'à une réécriture : 90 s suffisent. */
export const maxDuration = 120;

/** Preuves autorisees dans un mail : toute autre experience est inventee. */
const PUBLIC_PROOFS = PERSONA.proofs.filter((proof) => proof.publicOk).map((proof) => proof.text);

const SIMILARITY_LIMIT = 0.4;
const HISTORY = 10;

const CONTACT_SCHEMA = z.object({
  email: z.string(),
  full_name: z.string().nullable(),
  position: z.string().nullable(),
  confidence: z.number().nullable(),
});

const BODY_SCHEMA = z.object({
  prospectId: z.string().min(1),
  tone: z.string().optional(),
  /**
   * Analyse déjà calculée, renvoyée par une génération précédente. Sa présence
   * fait sauter l'étape 1 ET tous les appels externes : c'est ce qui permet au
   * bouton « Autre angle » de ne rien coûter en crédits.
   */
  cachedAnalysis: ANALYSIS_SCHEMA.optional(),
  cachedContact: CONTACT_SCHEMA.nullish(),
  /** Accroche et pain à utiliser, quand on bascule d'angle. */
  angleIndex: z.number().int().min(0).optional(),
});

/** Lecture du site — best effort, jamais bloquante. */
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

/**
 * Recherche du contact nominatif — au moment du brouillon, jamais avant.
 *
 * Trois tentatives successives, et l'absence de contact est un resultat
 * acceptable : le mail commencera par « Bonjour, » et l'ecran affichera un
 * badge « sans contact nominatif ». Aucune etape ne peut faire echouer la
 * generation.
 */
async function findContact(
  prospect: Prospect,
): Promise<{ contact: DecisionMakerContact | null; warning?: EnrichmentWarning }> {
  const domain = toDomain(prospect.website);
  if (!domain) return { contact: null, warning: { source: "hunter", message: "aucun site connu" } };
  if (!hasHunterKey()) {
    return { contact: null, warning: { source: "hunter", message: "cle absente : decideur non recherche" } };
  }

  const figures = prospect.key_figures ?? {};
  const leaderPerson =
    typeof figures.leader_person === "string" ? figures.leader_person : null;
  const leader = typeof figures.leader === "string" ? figures.leader : null;

  // 1. Un decideur sur le domaine.
  const search = await findDecisionMaker(domain, leaderPerson ?? leader, prospect.id);
  if (search.ok && search.data) return { contact: search.data };

  if (!search.ok && search.quotaExceeded) {
    const quota = await fetchQuota();
    const detail = quota
      ? `quota atteint (${quota.used}/${quota.available} recherches du plan ${quota.planName ?? "en cours"})`
      : "quota de recherches atteint pour ce mois";
    return { contact: null, warning: { source: "hunter", message: detail } };
  }
  if (!search.ok) return { contact: null, warning: { source: "hunter", message: search.error } };

  // 2. L'adresse du dirigeant personne physique, reconstruite par Hunter.
  const parts = (leaderPerson ?? "").trim().split(/\s+/);
  if (parts.length >= 2) {
    const finder = await findEmailByName(domain, parts[0], parts.slice(1).join(" "), prospect.id);
    if (finder.ok && finder.data) return { contact: finder.data };
    if (!finder.ok && finder.quotaExceeded) {
      return { contact: null, warning: { source: "hunter", message: "quota de recherches atteint pour ce mois" } };
    }
  }

  // 3. Rien : on le dit, et on ecrit « Bonjour, ».
  return {
    contact: null,
    warning: { source: "hunter", message: "aucun contact nominatif trouve sur ce domaine" },
  };
}

/** Appel OpenAI générique, avec journalisation du coût réel. */
async function ask(
  system: string,
  user: string,
  temperature: number,
  operation: string,
  prospectId: string,
): Promise<string> {
  const completion = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  if (completion.usage) {
    await recordOpenAiUsage({
      model: OPENAI_MODEL,
      promptTokens: completion.usage.prompt_tokens ?? 0,
      completionTokens: completion.usage.completion_tokens ?? 0,
      operation,
      prospectId,
    });
  }
  return completion.choices[0]?.message?.content ?? "";
}

/** Déplace l'angle choisi en tête, pour le bouton « Autre angle ». */
function applyAngle(analysis: DeepAnalysis, index?: number): DeepAnalysis {
  if (index === undefined) return analysis;
  return {
    ...analysis,
    chosen: {
      ...analysis.chosen,
      hookIndex: index % analysis.hookCandidates.length,
      painIndex: index % analysis.painCandidates.length,
    },
  };
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const parsedBody = BODY_SCHEMA.safeParse(await readJson<unknown>(request));
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const body = parsedBody.data;
  const tone: ToneKey = coerceTone(body.tone);

  const { data: prospect, error } = await session.supabase
    .from("prospects")
    .select("*")
    .eq("id", body.prospectId)
    .single();

  if (error || !prospect) {
    return NextResponse.json({ error: "Prospect introuvable." }, { status: 404 });
  }
  // Un prospect perdu est clos : generer un mail pour lui, c'est relancer
  // quelqu'un qui a deja dit non, et payer des credits pour le faire.
  if (prospect.status === "perdu") {
    return NextResponse.json(
      { error: "Prospect clôturé : ce prospect est marqué « Perdu », la génération est désactivée." },
      { status: 409 },
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY absente : la génération est indisponible." },
      { status: 503 },
    );
  }

  const warnings: EnrichmentWarning[] = [];
  const reuse = Boolean(body.cachedAnalysis);

  // Bascule d'angle : on rejoue UNIQUEMENT la rédaction. Aucun appel Linkup,
  // Pappers ou Hunter — c'est tout l'intérêt du bouton.
  let contact: DecisionMakerContact | null = null;
  let pages: PageContent[] = [];

  if (reuse) {
    contact = (body.cachedContact as DecisionMakerContact | null | undefined) ?? null;
  } else {
    const [siteOutcome, contactOutcome] = await Promise.all([
      readSite(prospect),
      findContact(prospect).catch(() => ({ contact: null, warning: undefined })),
    ]);
    pages = siteOutcome.pages;
    contact = contactOutcome.contact;
    if (siteOutcome.warning) warnings.push(siteOutcome.warning);
    if (contactOutcome.warning) warnings.push(contactOutcome.warning);
  }

  // Les faits sont TOUJOURS recalcules cote serveur : le client n'est pas une
  // source de verite, meme pour des donnees qu'il a recues de nous.
  const siteText = pages.map((page) => page.markdown).join("\n");
  const { facts, leaderPerson } = buildFacts(prospect, contact, new Date(), siteText);

  let analysis: DeepAnalysis;
  if (body.cachedAnalysis) {
    analysis = body.cachedAnalysis;
  } else {
    const outcome = await runAnalysisWithRetry(
      (system, user, temperature, operation) => ask(system, user, temperature, operation, prospect.id),
      prospect,
      facts,
      pages,
    );
    if (!outcome.analysis) {
      return NextResponse.json({ error: `Analyse inexploitable : ${outcome.error}` }, { status: 502 });
    }
    analysis = outcome.analysis;
  }
  analysis = applyAngle(analysis, body.angleIndex);

  if (isGenericAnalysis(analysis)) {
    warnings.push({
      source: "openai",
      message:
        "Aucune donnée ne permettait un diagnostic spécifique : le pain retenu reste générique. " +
        "Renseignez le site du prospect ou relancez une recherche de signaux.",
    });
  }

  // Anti-répétition : on interdit les ouvertures déjà servies, puis on MESURE.
  const historyResult = await session.supabase
    .from("messages")
    .select("body")
    .eq("type", "intro")
    .order("created_at", { ascending: false })
    .limit(HISTORY);
  const previous = (historyResult.data ?? []).map((row) => (row as { body: string }).body);
  const avoid = previous.flatMap((text) => {
    const { opening, closing } = edges(text);
    return [opening, closing].filter(Boolean);
  });

  const writingInput = {
    tone,
    analysis,
    facts,
    contact,
    prospectId: prospect.id,
    companyName: prospect.company_name,
    avoid,
    leaderPerson,
  };
  const plan = planFor(writingInput);

  let email: GeneratedEmail | null = parseEmail(
    await ask(
      buildWritingPrompt(writingInput),
      `Écris le mail pour ${prospect.company_name}.`,
      0.85,
      `redaction:${tone}`,
      prospect.id,
    ),
  );
  if (!email) {
    return NextResponse.json({ error: "Brouillon inexploitable." }, { status: 502 });
  }

  // --- Garde-fous déterministes, puis juge --------------------------------
  const context = {
    facts,
    contact,
    tone,
    companyName: prospect.company_name,
    proofs: PUBLIC_PROOFS,
    plan,
  };
  let validation = validateEmail(email, context);
  let critique: Critique | null = parseCritique(
    await ask(
      buildCriticPrompt(facts, PUBLIC_PROOFS),
      buildCriticContext(analysis, email),
      0,
      "critique",
      prospect.id,
    ),
  );
  let failing = critique ? failingCriteria(critique) : [];

  // UNE seule réécriture : au-delà, on rend la main plutôt que de boucler.
  if (!validation.ok || failing.length > 0) {
    const feedback = [...validation.failures, ...failing].map((line) => `- ${line}`).join("\n");
    const rewritten = parseEmail(
      await ask(
        buildWritingPrompt({ ...writingInput, critique: feedback }),
        `Réécris le mail pour ${prospect.company_name}.`,
        0.75,
        `redaction:${tone}:rewrite`,
        prospect.id,
      ),
    );

    if (rewritten) {
      const secondValidation = validateEmail(rewritten, context);
      const secondCritique = parseCritique(
        await ask(
          buildCriticPrompt(facts, PUBLIC_PROOFS),
          buildCriticContext(analysis, rewritten),
          0,
          "critique:rewrite",
          prospect.id,
        ),
      );
      const secondFailing = secondCritique ? failingCriteria(secondCritique) : [];

      // On ne garde la réécriture que si elle est réellement meilleure.
      const improved =
        secondValidation.failures.length + secondFailing.length <
        validation.failures.length + failing.length;
      if (improved) {
        email = rewritten;
        validation = secondValidation;
        critique = secondCritique;
        failing = secondFailing;
      }
    }
  }

  const similarity = maxSimilarity(email.body, previous);
  if (similarity > SIMILARITY_LIMIT) {
    warnings.push({
      source: "openai",
      message: `Ce brouillon ressemble à ${Math.round(similarity * 100)} % à un mail déjà envoyé.`,
    });
  }

  if (contact && !prospect.email && !reuse) {
    await session.supabase.from("prospects").update({ email: contact.email }).eq("id", prospect.id);
  }

  const hook = analysis.hookCandidates[analysis.chosen.hookIndex] ?? analysis.hookCandidates[0];
  const pain = analysis.painCandidates[analysis.chosen.painIndex] ?? analysis.painCandidates[0];

  // « Indice de besoin » : une friction operationnelle, pas un bulletin de
  // sante. On ecarte les implications qui decrivent une entreprise qui va
  // bien, et la confiance se calcule sur ce qu'on a reellement collecte.
  const lead = analysis.implications.find((item) => describesNeed(item.text)) ?? null;
  const confidence = needConfidence({
    facts,
    hasSiteContent: siteText.trim().length > 0,
    vocabularyConfirmed: Boolean(
      lead && siteText && describesNeed(siteText) && lead.factIds.length >= 2,
    ),
  });
  const evidence: Evidence[] = [
    { label: "Modèle économique", value: analysis.businessModel.text, source: "Analyse du site et du NAF" },
    ...facts.map((fact) => ({
      label: fact.label,
      value: fact.value,
      source: fact.source,
      ...(fact.url ? { url: fact.url } : {}),
    })),
  ];

  return NextResponse.json({
    pain_point: pain?.task ?? "",
    evidence,
    email,
    analysis,
    facts,
    contact,
    warnings,
    critique,
    /** Les points qui n'ont pas pu être corrigés : l'UI affiche « à revoir ». */
    needsReview: !validation.ok || failing.length > 0,
    reviewReasons: [...validation.failures, ...failing],
    needLead: lead
      ? {
          text: lead.text,
          factIds: lead.factIds,
          confidence: confidence.value,
          /** Detail affiche au survol : d'ou vient cette confiance. */
          confidenceDetail: confidence.explanation,
        }
      : null,
    chosenHook: hook,
    chosenPain: pain,
  });
}
