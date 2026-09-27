/**
 * Extraction STRUCTURÉE des signaux — un appel LLM léger par entreprise.
 *
 * Avant ce module, l'information utile restait noyée dans le markdown : on
 * stockait « - [Automaticien/ne](/offre/12) 🔥 CDI — Blue EnerFreeze, filiale
 * du Groupe STEF » comme une citation opaque. Le fait exploitable — un poste
 * d'automaticien ouvert, et une appartenance au groupe STEF — n'était jamais
 * isolé.
 *
 * Trois garde-fous, dans cet ordre, et un élément qui en rate un est REJETÉ :
 *
 *   1. ANCRAGE — le document doit nommer l'entreprise ET porter un second
 *      identifiant (SIREN, ville ou domaine). Sans quoi « Jacquet » peut
 *      désigner trois sociétés différentes.
 *   2. CITATION VÉRIFIÉE — chaque élément cite une phrase exacte du texte
 *      source, retrouvée par inclusion côté code. Un modèle qui reformule,
 *      résume ou invente échoue ce test.
 *   3. DATATION CALCULÉE — la date vient du code (source, texte, URL), pas du
 *      modèle. Un élément indatable sort avec `postedAt: null`, affiché
 *      « non daté », et ne compte ni dans le score ni comme accroche.
 *
 * Modèle : rôle « extract » (`OPENAI_MODEL_EXTRACT`, sinon `OPENAI_MODEL`,
 * sinon gpt-4o-mini), en mode JSON, température 0, une seule reprise si la
 * sortie est invalide.
 */
import { z } from "zod";
import { getOpenAI } from "@/lib/openai";
import { modelFor, reasoningEffortFor } from "@/lib/ai/models";
import { buildParams } from "@/lib/ai/params";
import { withParamFallback } from "@/lib/ai/chat";
import { recordOpenAiUsage } from "@/lib/usage/record";
import { cleanText, excerpt, normalizeForMatch, quoteIsGrounded } from "./clean";
import { parseTextDate, resolvePostedAt, type DateBasis } from "./dates";
import { mentionsExactDenomination } from "./entity-match";
import { toDomain } from "./http";

// ---------------------------------------------------------------------------
// Schéma de sortie
// ---------------------------------------------------------------------------

export const JOB_CATEGORIES = ["automation", "data", "it", "ops", "sales", "other"] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const EVENT_TYPES = [
  "levée",
  "ouverture_site",
  "acquisition",
  "nouveau_client",
  "nouvelle_offre",
  "autre",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const QUOTE = z.string().min(15).max(400);

/** Ce que le modèle doit produire. Les dates qu'il propose ne font pas foi. */
const RAW_SCHEMA = z.object({
  parentGroup: z
    .object({ name: z.string().min(2).max(120), evidenceQuote: QUOTE, url: z.string().min(4) })
    .nullable(),
  jobPostings: z
    .array(
      z.object({
        title: z.string().min(2).max(140),
        category: z.enum(JOB_CATEGORIES),
        postedAt: z.string().nullable(),
        url: z.string().min(4),
        evidenceQuote: QUOTE,
      }),
    )
    .max(10),
  events: z
    .array(
      z.object({
        type: z.enum(EVENT_TYPES),
        date: z.string().nullable(),
        url: z.string().min(4),
        evidenceQuote: QUOTE,
      }),
    )
    .max(10),
  siteSummary: z
    .object({
      offer: z.string().min(10).max(400),
      customers: z.string().max(300),
      vocabulary: z.array(z.string().max(60)).max(12),
    })
    .nullable(),
});

export type RawExtraction = z.infer<typeof RAW_SCHEMA>;

/** Élément retenu, daté par le code et rattaché à sa preuve. */
export interface JobPosting {
  title: string;
  category: JobCategory;
  postedAt: string | null;
  dateBasis: DateBasis | null;
  url: string;
  evidenceQuote: string;
  /**
   * Verdict de verification de la page de l'offre (cf. `job-posting.ts`).
   * Absent tant que la verification n'a pas eu lieu.
   */
  freshness?: "datée" | "en ligne" | "périmée" | "introuvable";
}

export interface CompanyEvent {
  type: EventType;
  date: string | null;
  dateBasis: DateBasis | null;
  url: string;
  evidenceQuote: string;
}

export interface ParentGroup {
  name: string;
  evidenceQuote: string;
  url: string;
}

export interface SiteSummary {
  offer: string;
  customers: string;
  vocabulary: string[];
}

/** Élément écarté, avec la raison : sert au diagnostic et aux métriques. */
export interface RejectedItem {
  kind: "parentGroup" | "jobPosting" | "event" | "siteSummary";
  reason: "citation introuvable" | "source non ancrée" | "url inconnue";
  url?: string;
}

export interface Extraction {
  parentGroup: ParentGroup | null;
  jobPostings: JobPosting[];
  events: CompanyEvent[];
  siteSummary: SiteSummary | null;
  rejected: RejectedItem[];
  /** `false` quand aucun appel n'a pu être fait (pas de texte, pas de clé). */
  ran: boolean;
}

export const EMPTY_EXTRACTION: Extraction = {
  parentGroup: null,
  jobPostings: [],
  events: [],
  siteSummary: null,
  rejected: [],
  ran: false,
};

// ---------------------------------------------------------------------------
// Documents d'entrée
// ---------------------------------------------------------------------------

export interface SourceDocument {
  url: string;
  title: string;
  /** Texte brut, tel que rendu par la source. */
  content: string;
  /** Date de publication annoncée par la source, si elle en donne une. */
  sourceDate?: string | null;
}

/** Document nettoyé, avec son verdict d'ancrage. */
interface PreparedDocument extends SourceDocument {
  clean: string;
  anchored: boolean;
}

export interface CompanyIdentity {
  name: string;
  siren?: string | null;
  city?: string | null;
  postalCode?: string | null;
  website?: string | null;
}

/**
 * ANCRAGE anti-homonymie. Un document est rattaché à l'entreprise s'il :
 *   - est sur son domaine (c'est son propre site), ou
 *   - porte son SIREN, ou
 *   - porte sa dénomination EXACTE ET un second identifiant (ville, code
 *     postal, domaine). Un nom proche — « Jacquet Metal Service » pour
 *     JACQUET PARIS — ne compte pas (lib/enrichment/entity-match.ts).
 */
export function isAnchored(document: SourceDocument, company: CompanyIdentity): boolean {
  const ownDomain = toDomain(company.website ?? null);
  const host = toDomain(document.url);
  if (ownDomain && host && host.endsWith(ownDomain)) return true;

  const raw = `${document.title}\n${document.content}`;
  if (company.siren && company.siren.length === 9 && raw.replace(/[\s.]/g, "").includes(company.siren)) {
    return true;
  }

  const haystack = normalizeForMatch(`${document.title} ${document.content} ${document.url}`);
  if (!mentionsExactDenomination(raw, company.name)) return false;

  const second = [company.siren, company.city, company.postalCode, ownDomain]
    .filter((value): value is string => Boolean(value && value.length >= 3))
    .some((value) => haystack.includes(normalizeForMatch(value)));

  return second;
}

/** Budget de contexte : au-delà, on paie du token sans rien apprendre de plus. */
const MAX_DOC_CHARS = 2_200;
const MAX_TOTAL_CHARS = 9_000;

function prepare(documents: SourceDocument[], company: CompanyIdentity): PreparedDocument[] {
  const prepared: PreparedDocument[] = [];
  let budget = MAX_TOTAL_CHARS;

  for (const document of documents) {
    if (budget <= 0) break;
    const clean = cleanText(document.content, Math.min(MAX_DOC_CHARS, budget));
    if (clean.length < 40) continue;
    budget -= clean.length;
    prepared.push({ ...document, clean, anchored: isAnchored({ ...document, content: clean }, company) });
  }
  return prepared;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Tu extrais des faits VÉRIFIABLES sur une entreprise française, à partir de documents web bruts.

Règles absolues :
- Chaque élément DOIT contenir "evidenceQuote" : une phrase copiée MOT POUR MOT du document, entre 15 et 400 caractères. Ne reformule jamais, ne corrige ni l'orthographe ni la ponctuation. Si tu ne peux pas copier une phrase qui prouve l'élément, n'émets pas l'élément.
- "url" DOIT être exactement l'URL du document d'où vient la citation.
- N'invente aucune date. Si le document n'en donne pas, mets null.
- Ne déduis rien : tu rapportes ce qui est écrit, pas ce que tu supposes.
- Si un document parle d'une entreprise homonyme, ignore-le.
- UN ÉVÉNEMENT N'EST À ELLE QUE SI ELLE EN EST LE SUJET. Le site d'un cabinet de
  conseil, d'une banque d'affaires, d'une agence ou d'un intégrateur raconte les
  opérations de ses CLIENTS : « Groupe Échelle réalise une acquisition au
  Québec » sur le site d'un conseil en fusions-acquisitions est l'acquisition du
  Groupe Échelle, pas celle du conseil. N'émets pas cet event. Même règle pour
  une référence client, un témoignage, une étude de cas, un communiqué commun où
  l'autre partie agit.

Ce que tu cherches :
- parentGroup : l'entreprise est présentée comme filiale/membre d'un groupe ou détenue par une société mère. Sinon null.
- jobPostings : postes ouverts. category = automation (automaticien, robotique, process), data, it, ops (logistique, ADV, planification, back-office), sales, other.
- events : levée (levée de fonds), ouverture_site (nouveau site, agence, usine), acquisition (rachat), nouveau_client (contrat remporté), nouvelle_offre (nouveau produit ou service), autre.
  Un event est un ÉVÉNEMENT DATABLE (il a eu ou aura lieu à un moment précis). La présentation de l'entreprise — date de fondation, historique, valeurs, savoir-faire, page « À propos », « Qui sommes-nous », « Notre histoire » ou page « Recrutement » sans poste précis — n'est PAS un event : n'en émets pas.
- siteSummary : ce que l'entreprise vend (offer), pour qui (customers), et le vocabulaire métier qu'elle emploie (vocabulary). Uniquement depuis son propre site. Sinon null.

Réponds en JSON strict conforme au schéma demandé, sans commentaire.`;

function buildUserPrompt(company: CompanyIdentity, documents: PreparedDocument[]): string {
  const identity = [
    `Entreprise : ${company.name}`,
    company.siren ? `SIREN : ${company.siren}` : null,
    company.city ? `Ville : ${company.city}` : null,
    company.website ? `Site : ${company.website}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const blocks = documents
    .map(
      (document, index) =>
        `--- DOCUMENT ${index + 1} ---\nurl: ${document.url}\ntitre: ${document.title}\n${document.clean}`,
    )
    .join("\n\n");

  return `${identity}

${blocks}

Schéma JSON attendu :
{
  "parentGroup": { "name": string, "evidenceQuote": string, "url": string } | null,
  "jobPostings": [ { "title": string, "category": "automation"|"data"|"it"|"ops"|"sales"|"other", "postedAt": string|null, "url": string, "evidenceQuote": string } ],
  "events": [ { "type": "levée"|"ouverture_site"|"acquisition"|"nouveau_client"|"nouvelle_offre"|"autre", "date": string|null, "url": string, "evidenceQuote": string } ],
  "siteSummary": { "offer": string, "customers": string, "vocabulary": string[] } | null
}`;
}

// ---------------------------------------------------------------------------
// Vérification et datation
// ---------------------------------------------------------------------------

/**
 * Date d'un élément : calculée par le CODE.
 *
 * La date proposée par le modèle n'est acceptée qu'en dernier recours, et
 * seulement si elle se relit dans le document — sinon elle est ignorée.
 */
function dateFor(
  document: PreparedDocument,
  quote: string,
  modelDate: string | null,
  now: Date,
): { date: string | null; basis: DateBasis | null } {
  const resolved = resolvePostedAt({
    sourceDate: document.sourceDate,
    // La citation d'abord : « publiée le 3 mars » y figure plus souvent que
    // dans le reste de la page, qui peut dater d'autres articles.
    text: `${quote}\n${document.clean}`,
    url: document.url,
    now,
  });
  if (resolved.date) return resolved;

  if (modelDate) {
    const parsed = parseTextDate(modelDate, now);
    if (parsed && normalizeForMatch(document.clean).includes(parsed.slice(0, 4))) {
      return { date: parsed, basis: "texte" };
    }
  }
  return { date: null, basis: null };
}

/** Applique ancrage + citation vérifiée sur la sortie brute du modèle. */
export function verify(raw: RawExtraction, documents: PreparedDocument[], now: Date): Extraction {
  const byUrl = new Map(documents.map((document) => [document.url, document]));
  const rejected: RejectedItem[] = [];

  /** Retrouve le document cité, et dit si l'élément est recevable. */
  const check = (
    kind: RejectedItem["kind"],
    url: string,
    quote: string,
  ): PreparedDocument | null => {
    const document = byUrl.get(url) ?? documents.find((item) => item.url.startsWith(url));
    if (!document) {
      rejected.push({ kind, reason: "url inconnue", url });
      return null;
    }
    if (!document.anchored) {
      rejected.push({ kind, reason: "source non ancrée", url });
      return null;
    }
    if (!quoteIsGrounded(quote, document.clean)) {
      rejected.push({ kind, reason: "citation introuvable", url });
      return null;
    }
    return document;
  };

  let parentGroup: ParentGroup | null = null;
  if (raw.parentGroup) {
    const document = check("parentGroup", raw.parentGroup.url, raw.parentGroup.evidenceQuote);
    if (document) {
      parentGroup = {
        name: raw.parentGroup.name.trim(),
        evidenceQuote: excerpt(raw.parentGroup.evidenceQuote, 260),
        url: document.url,
      };
    }
  }

  const jobPostings: JobPosting[] = [];
  for (const posting of raw.jobPostings) {
    const document = check("jobPosting", posting.url, posting.evidenceQuote);
    if (!document) continue;
    const { date, basis } = dateFor(document, posting.evidenceQuote, posting.postedAt, now);
    jobPostings.push({
      title: posting.title.trim(),
      category: posting.category,
      postedAt: date,
      dateBasis: basis,
      url: document.url,
      evidenceQuote: excerpt(posting.evidenceQuote, 260),
    });
  }

  const events: CompanyEvent[] = [];
  for (const event of raw.events) {
    const document = check("event", event.url, event.evidenceQuote);
    if (!document) continue;
    const { date, basis } = dateFor(document, event.evidenceQuote, event.date, now);
    events.push({
      type: event.type,
      date,
      dateBasis: basis,
      url: document.url,
      evidenceQuote: excerpt(event.evidenceQuote, 260),
    });
  }

  // Le résumé de site n'est retenu que s'il vient d'une source ancrée.
  let siteSummary: SiteSummary | null = null;
  if (raw.siteSummary) {
    const fromOwnSite = documents.some((document) => document.anchored);
    if (fromOwnSite) {
      siteSummary = {
        offer: excerpt(raw.siteSummary.offer, 300),
        customers: excerpt(raw.siteSummary.customers, 220),
        vocabulary: raw.siteSummary.vocabulary.map((word) => word.trim()).filter(Boolean).slice(0, 12),
      };
    } else {
      rejected.push({ kind: "siteSummary", reason: "source non ancrée" });
    }
  }

  return { parentGroup, jobPostings, events, siteSummary, rejected, ran: true };
}

// ---------------------------------------------------------------------------
// Appel
// ---------------------------------------------------------------------------

/** Un seul appel, plus une reprise si la sortie n'est pas conforme au schéma. */
export async function extractSignals(
  company: CompanyIdentity,
  documents: SourceDocument[],
  options: { now?: Date; prospectId?: string | null } = {},
): Promise<Extraction> {
  const now = options.now ?? new Date();
  const prepared = prepare(documents, company);
  if (!prepared.length || !process.env.OPENAI_API_KEY) return EMPTY_EXTRACTION;

  const user = buildUserPrompt(company, prepared);

  const model = modelFor("extract");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const content =
      attempt === 0
        ? user
        : `${user}\n\nTa réponse précédente n'était pas conforme au schéma. Recommence, JSON strict uniquement.`;

    // `buildParams` n'envoie que ce que le modele accepte, et le filet rejoue
    // une fois s'il refuse quand meme : c'est ce qui manquait quand gpt-6-*
    // a remplace gpt-4o-mini et que `temperature: 0` faisait tomber toute
    // l'extraction en 400.
    const completion = await withParamFallback(
      model,
      () => buildParams({ model, temperature: 0, reasoningEffort: reasoningEffortFor("extract") }),
      (params) =>
        getOpenAI().chat.completions.create({
          ...(params as { model: string }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content },
          ],
        }),
    );

    if (completion.usage) {
      await recordOpenAiUsage({
        model,
        promptTokens: completion.usage.prompt_tokens ?? 0,
        completionTokens: completion.usage.completion_tokens ?? 0,
        operation: "extract-signals",
        prospectId: options.prospectId,
      });
    }

    try {
      const parsed = RAW_SCHEMA.parse(JSON.parse(completion.choices[0]?.message?.content ?? ""));
      return verify(parsed, prepared, now);
    } catch {
      // Sortie illisible ou hors schéma : on retente une fois, puis on renonce.
    }
  }

  return { ...EMPTY_EXTRACTION, ran: true };
}
