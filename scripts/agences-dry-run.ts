/**
 * MESURE À BLANC du segment « Agences » — aucun envoi, jamais.
 *
 * À LANCER EN LOCAL (agent VS Code) : lit `.env.local`, consomme des appels
 * PAYANTS. Trois plafonds sont tenus et affichés : crédits Pappers, crédits
 * Hunter, dépense OpenAI.
 *
 *   npm run dry:agences                      (simulation : rien n'est écrit)
 *   npm run dry:agences -- --write           (crée les fiches et les brouillons)
 *   npm run dry:agences -- --zone 69 --limit 10 --hunter-cap 15 --openai-cap 1
 *
 * CHAÎNE SUIVIE — celle de l'application, pas une imitation :
 *   1. annuaire public (gratuit) : candidats par code NAF, tranches 3 à 50 ;
 *   2. Pappers (1 crédit) : site officiel et effectif réel. C'est Pappers, et
 *      non une recherche web, qui donne le site — moins cher, plus fiable, et
 *      la mesure ne dépend plus du plafond Linkup du jour ;
 *   3. lecture du site (fetch direct, gratuit) puis classement par le segment ;
 *   4. job `reanalyze` : profil métier, faits, contact nominatif — la chaîne
 *      d'agent1, appelée telle quelle, jamais réécrite ;
 *   5. job `email_generate` : le brouillon F5.
 *
 * Les brouillons sont marqués `origin: "eval"` : ils existent et se mesurent,
 * mais n'entrent PAS dans la file « Aujourd'hui » — aucun envoi ne peut partir
 * par accident.
 *
 * Rapport : evals/agences/report-AAAA-MM-JJ.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { scriptJobSource } from "@/lib/jobs/regen-cap";
import { createClient } from "@supabase/supabase-js";
import { AGENCES_EFFECTIF_CODES, AGENCES_NAF, classifyAgence } from "@/lib/segments/agences";
import { segmentMarks } from "@/lib/segments";
import { checkF5, type F5Verdict } from "@/lib/segments/mail-f5";
import { judgeChecklist, type ChecklistVerdict } from "@/lib/emails/quality/checklist";
import { countedText } from "@/lib/mail-preflight/words";
import { liveAsk } from "./quality-live";
import { coverSite } from "@/lib/enrichment/site";
import { searchCompanies } from "@/lib/enrichment/gouv";
import { resolveZone } from "@/lib/enrichment/geo";
import { fetchInpiOpposition } from "@/lib/enrichment/inpi";
import { fetchPappers } from "@/lib/enrichment/pappers";
import { findEmailByName } from "@/lib/enrichment/hunter";
import { withLinkupRun } from "@/lib/linkup/run-cap";
import type { CompanyBase } from "@/lib/enrichment/types";

// ---------------------------------------------------------------------------
// Environnement et options
// ---------------------------------------------------------------------------

function loadEnv(file = ".env.local"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const WRITE = args.includes("--write");
const ZONE = flag("zone", "69");
const LIMIT = Number(flag("limit", "10")) || 10;
const HUNTER_CAP = Number(flag("hunter-cap", "15")) || 15;
/** Credits reserves a l'essai nominatif (dirigeant du registre + domaine). */
const FINDER_CAP = Number(flag("finder-cap", "10")) || 10;
const OPENAI_CAP = Number(flag("openai-cap", "1")) || 1;
/** Crédits Pappers que la mesure s'autorise : un par candidat examiné. */
const PAPPERS_CAP = Number(flag("pappers-cap", "25")) || 25;
/**
 * Candidats examinés — la LARGEUR du vivier, distincte du plafond Pappers.
 *
 * Le rendement du ciblage est d'environ 15 % (mesure du 07/10/2026 : 6 agences
 * sur 60, puis 4 sur 24) : atteindre dix agences demande donc d'en examiner
 * près de quatre-vingts. Quand les deux notions étaient confondues, `--limit 10`
 * s'arrêtait à 4 sans rien dire.
 */
const SCAN = Number(flag("scan", String(Math.min(LIMIT * 8, 80)))) || Math.min(LIMIT * 8, 80);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");
const db = createClient(url, key, { auth: { persistSession: false } });

/**
 * Codes NAF par ordre de RENDEMENT attendu : les agences de publicité et de
 * communication d'abord, les codes informatiques ensuite — ils contiennent
 * autant d'éditeurs de logiciels et d'ESN que d'agences.
 */
const NAF_ORDER = ["73.11Z", "70.21Z", "74.10Z", "62.01Z", "62.02A"] as const;

// ---------------------------------------------------------------------------
// Coûts réels, lus dans api_usage
// ---------------------------------------------------------------------------

async function spend(service: string, since: string): Promise<{ eur: number; calls: number }> {
  const { data } = await db
    .from("api_usage")
    .select("cost")
    .gte("created_at", since)
    .eq("service", service);
  const rows = (data ?? []) as { cost: number }[];
  return { eur: rows.reduce((total, row) => total + (Number(row.cost) || 0), 0), calls: rows.length };
}

// ---------------------------------------------------------------------------
// Phase 1 — candidats, fiche Pappers, lecture du site, classement
// ---------------------------------------------------------------------------

interface Candidate {
  base: CompanyBase;
  website: string | null;
  siteStatus: string;
  headcount: number | null;
  leader: string | null;
  /** Dirigeant personne physique, découpé : `email-finder` demande les deux. */
  leaderFirst: string | null;
  leaderLast: string | null;
  revenue: number | null;
  verdict: ReturnType<typeof classifyAgence>;
}

/**
 * « Prénom Nom » de l'annuaire, découpé pour `email-finder`. Le dernier mot
 * fait le nom de famille : l'annuaire rend « Jean-Paul Mercier », pas une liste.
 */
function splitLeader(person: string | null): { leaderFirst: string | null; leaderLast: string | null } {
  const parts = (person ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { leaderFirst: null, leaderLast: null };
  return { leaderFirst: parts[0], leaderLast: parts[parts.length - 1] };
}

async function qualify(since: string): Promise<{ kept: Candidate[]; rejected: Candidate[] }> {
  const pool: CompanyBase[] = [];
  let total = 0;

  /*
   * `criteria.zone` n'est qu'un LIBELLÉ : le filtre géographique vient de
   * `options.zone`, une zone résolue (gouv.ts, ligne 296). Sans ça, « zone 69 »
   * s'affichait partout alors que le vivier était national — défaut trouvé le
   * 09/10 en comparant trois zones qui rendaient la même liste.
   */
  const resolved = await resolveZone(ZONE);
  if (!resolved.ok) throw new Error(`Zone ${ZONE} non résolue : ${resolved.error}`);

  for (const naf of NAF_ORDER) {
    if (pool.length >= SCAN) break;
    const search = await searchCompanies(
      { naf: [naf], tranches: [...AGENCES_EFFECTIF_CODES], zone: ZONE },
      25,
      { zone: resolved.data },
    );
    if (!search.ok) {
      console.log(`  (${naf} : ${search.error})`);
      continue;
    }
    total += search.data.total;
    const page = search.data.companies.slice(0, SCAN - pool.length);
    console.log(
      `  ${naf} ${AGENCES_NAF[naf]} : ${search.data.total} en zone ${ZONE}, ${page.length} retenues pour examen`,
    );
    pool.push(...page);
  }

  console.log(
    `\nVivier : ${total} entreprises, ${pool.length} examinées une à une (objectif ${LIMIT})\n`,
  );

  const kept: Candidate[] = [];
  const rejected: Candidate[] = [];
  /** Ecartees gratuitement sur le RNE, avant toute depense. */
  let opposedCount = 0;

  for (const base of pool) {
    if (kept.length >= LIMIT) break;
    // Plafond de CRÉDITS, pas de candidats : au-delà on continue sans Pappers,
    // le site se devine depuis le nom (lib/enrichment/site.ts).
    const pappersUsed = (await spend("pappers", since)).calls;

    let pappersWebsite: string | null = null;
    let headcount: number | null = null;
    let leader: string | null = null;
    let leaderFirst: string | null = null;
    let leaderLast: string | null = null;
    let revenue: number | null = null;
    if (base.siren && pappersUsed < PAPPERS_CAP) {
      const pappers = await fetchPappers(base.siren);
      if (pappers.ok) {
        pappersWebsite = pappers.data.website;
        headcount = pappers.data.headcount;
        leader = pappers.data.leader;
        const person = (pappers.data.representatives ?? []).find(
          (item) => !item.isCompany && item.firstName && item.lastName,
        );
        leaderFirst = person?.firstName ?? null;
        leaderLast = person?.lastName ?? null;
        revenue = pappers.data.revenue_eur;
      }
    }

    /*
     * PORTE GRATUITE, avant toute depense. 53 % des agences de ces codes NAF
     * sont opposees a la prospection au RNE (mesure du 09/10, zones 75/33/13) :
     * lire leur site coutait une recherche Linkup et un credit Hunter pour
     * finir sur « aucun brouillon ». Le RNE ne coute rien, il passe en premier.
     */
    if (base.siren) {
      const opposition = await fetchInpiOpposition(base.siren);
      if (opposition.ok && opposition.refuses) {
        rejected.push({
          base,
          website: null,
          siteStatus: "non lu",
          headcount: null,
          leader: null,
          leaderFirst: null,
          leaderLast: null,
          revenue: null,
          verdict: { segment: "agences", fit: "dehors", reason: "opposée à la prospection (RNE) : aucun mail possible", signals: [], competitor: null },
        });
        opposedCount += 1;
        console.log(`  · ${base.company_name} — opposée à la prospection (RNE)`);
        continue;
      }
    }

    const site = await coverSite(
      {
        name: base.company_name,
        siren: base.siren,
        city: base.city,
        postalCode: base.postal_code,
        pappersWebsite,
        knownWebsite: base.website,
        contactEmail: base.email,
      },
      // Pappers a donné le site : inutile de payer une recherche web.
      { allowLinkupSearch: !pappersWebsite },
    );

    const verdict = classifyAgence({
      naf: base.naf_code,
      effectifCode: base.figures.effectif_code,
      headcount,
      siteText: site.pages.map((page) => page.text).join("\n") || null,
      companyName: base.company_name,
      website: site.url,
    });

    const row: Candidate = {
      base,
      website: site.url ?? pappersWebsite,
      siteStatus: site.status,
      headcount,
      leader,
      /*
       * Dirigeant personne physique : il vient de l'ANNUAIRE GRATUIT, lu à
       * l'identification. Le chercher chez Pappers était une erreur — la
       * politique de sobriété (pappers-policy.ts) ne l'appelle que si aucun
       * chiffre financier n'est publié, donc presque jamais : la mesure du
       * 07/10 n'a consommé aucun crédit et mon essai nominatif n'a jamais eu
       * de nom à donner à `email-finder`.
       */
      ...splitLeader(base.leader_person),
      revenue,
      verdict,
    };

    if (verdict.fit === "dedans") {
      kept.push(row);
      console.log(`  ✓ ${base.company_name} — ${verdict.signals.join(", ")} [${site.url}]`);
    } else {
      rejected.push(row);
      const why = site.note ? ` [${site.status} : ${site.note}]` : ` [site ${site.status}]`;
      console.log(`  · ${base.company_name} — ${verdict.reason ?? "hors segment"}${why}`);
    }
  }
  console.log(`\n${opposedCount} candidat(s) ecarte(s) gratuitement sur le RNE (opposition).\n`);
  return { kept, rejected };
}

// ---------------------------------------------------------------------------
// Phase 2 — fiche, enrichissement d'agent1, brouillon F5
// ---------------------------------------------------------------------------

interface Measured {
  name: string;
  prospectId: string | null;
  email: string | null;
  nominative: boolean;
  draft: { subject: string; body: string } | null;
  f5: F5Verdict | null;
  /** Verdict de la check-list commune (D1-D7, C1-C5) : la lecture, pas mes motifs. */
  checklist?: ChecklistVerdict | null;
  error: string | null;
}

async function upsert(candidate: Candidate, userId: string): Promise<string> {
  const figures: Record<string, unknown> = {
    ...segmentMarks(candidate.verdict),
    naf_code: candidate.base.naf_code ?? undefined,
    effectif_code: candidate.base.figures.effectif_code ?? undefined,
    site_status: candidate.siteStatus,
  };
  if (candidate.headcount !== null) figures.headcount = candidate.headcount;
  if (candidate.revenue !== null) figures.revenue_eur = candidate.revenue;
  if (candidate.leader) figures.leader = candidate.leader;

  const { data: existing } = await db
    .from("prospects")
    .select("id")
    .eq("user_id", userId)
    .eq("siren", candidate.base.siren ?? "")
    .maybeSingle();

  if (existing) {
    const id = (existing as { id: string }).id;
    await db
      .from("prospects")
      .update({ key_figures: figures as never, website: candidate.website })
      .eq("id", id);
    return id;
  }

  const { data, error } = await db
    .from("prospects")
    .insert({
      user_id: userId,
      company_name: candidate.base.company_name,
      siren: candidate.base.siren,
      website: candidate.website,
      sector: candidate.base.sector,
      size_range: candidate.base.size_range,
      city: candidate.base.city,
      source: "auto",
      status: "nouveau",
      signals: [],
      key_figures: figures,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(`fiche non créée : ${error.message}`);
  return (data as { id: string }).id;
}

/** Pilote un job comme le fait l'application, et rend son résultat. */
async function runJob(
  userId: string,
  type: "reanalyze" | "email_generate",
  prospectId: string,
  params: Record<string, unknown>,
  label: string,
  budgetMs: number,
): Promise<{ result: unknown } | { error: string }> {
  const { HANDLERS } = await import("@/lib/jobs/handlers");
  const { driveJob } = await import("@/lib/jobs/runner");
  const { EMPTY_PROGRESS } = await import("@/lib/jobs/types");

  const { data: job, error } = await db
    .from("jobs")
    .insert({
      user_id: userId,
      type,
      target: { prospectId, label: label.slice(0, 160) },
      // `segment` active la part réservée de LINKUP_RESERVE (agent1, #105) pour
      // les handlers qui la lisent ; le contexte posé plus bas la garantit de
      // toute façon pour les appels de CE processus.
      params: { prospectId, segment: "agences", ...params, ...scriptJobSource() },
      status: "queued",
      progress: EMPTY_PROGRESS,
    } as never)
    .select("id")
    .single();
  if (error || !job) return { error: `job ${type} non créé : ${error?.message}` };

  const final = await driveJob(db as never, (job as { id: string }).id, HANDLERS, budgetMs);
  if (!final || final.status !== "done") {
    return { error: `${type} : ${final?.error ?? final?.status ?? "sans réponse"}` };
  }
  return { result: final.result };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function report(input: {
  kept: Candidate[];
  rejected: Candidate[];
  measured: Measured[];
  finderWins: string[];
  finderMisses: string[];
  finderSkipped: string[];
  costs: Record<string, { eur: number; calls: number }>;
}): string {
  const total = input.measured.length;
  const examined = input.kept.length + input.rejected.length;
  const sitesRead = [...input.kept, ...input.rejected].filter((row) => row.siteStatus === "lu").length;
  const undecided = input.rejected.filter((row) => row.verdict.fit === "indécidable").length;
  const nominative = input.measured.filter((row) => row.nominative).length;
  const withEmail = input.measured.filter((row) => row.email).length;
  const drafted = input.measured.filter((row) => row.draft).length;
  // Prêt = la check-list commune dit oui. Mes motifs sont un préalable, pas le juge.
  const ready = input.measured.filter((row) => row.f5?.ready && row.checklist?.ready).length;
  const pct = (part: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");

  const examples = input.measured
    .filter((row) => row.draft)
    .slice(0, 3)
    .map((row) =>
      [
        `### ${row.name}`,
        "",
        `- contact : ${row.email ?? "aucun"}${row.nominative ? " (nominatif)" : ""}`,
        `- grille F5 : ${
          row.f5?.ready
            ? "complète"
            : (row.f5?.failed ?? []).map((item) => `${item.id} — ${item.detail}`).join(" · ")
        }`,
        "",
        "```",
        `Objet : ${row.draft?.subject ?? ""}`,
        "",
        row.draft?.body ?? "",
        "```",
        "",
      ].join("\n"),
    )
    .join("\n");

  const competitors = input.rejected.filter((row) => row.verdict.competitor);

  return [
    `# Segment Agences — mesure à blanc du ${new Date().toISOString().slice(0, 10)}`,
    "",
    `Zone ${ZONE} · ${input.kept.length} agences retenues · ${input.rejected.length} écartées · aucun envoi.`,
    "",
    "## Résultats",
    "",
    "| Indicateur | Taux | Détail |",
    "| --- | --- | --- |",
    `| Sites lus | ${examined ? `${Math.round((sitesRead / examined) * 100)} %` : "—"} | ${sitesRead}/${examined} candidats |`,
    `| Qualifiées | — | ${input.kept.length} |`,
    `| Indécidables (site non lu) | — | ${undecided} |`,
    `| Concurrents / partenaires | — | ${input.rejected.filter((row) => row.verdict.competitor).length} |`,
    `| Adresse trouvée | ${pct(withEmail)} | ${withEmail}/${total} |`,
    `| Contact NOMINATIF | ${pct(nominative)} | ${nominative}/${total} |`,
    `| dont reconstruits (dirigeant + domaine) | — | ${input.finderWins.length} |`,
    `| Brouillon F5 généré | ${pct(drafted)} | ${drafted}/${total} |`,
    `| Mail prêt (check-list commune) | ${pct(ready)} | ${ready}/${total} |`,
    "",
    "## Coûts réels (api_usage, depuis le début du run)",
    "",
    "| Service | Appels | Coût |",
    "| --- | --- | --- |",
    ...Object.entries(input.costs).map(
      ([service, value]) => `| ${service} | ${value.calls} | ${value.eur.toFixed(4)} € |`,
    ),
    "",
    "## Essai nominatif — dirigeant du registre + domaine → Hunter email-finder",
    "",
    ...(input.finderWins.length ? input.finderWins.map((item) => `- trouvé : ${item}`) : ["- aucune adresse reconstruite"]),
    ...input.finderMisses.map((item) => `- sans réponse : ${item}`),
    ...input.finderSkipped.map((item) => `- non tenté : ${item}`),
    "",
    "## Écartées",
    "",
    ...input.rejected.map(
      (row) => `- ${row.base.company_name} — ${row.verdict.reason ?? "hors segment"}`,
    ),
    "",
    `### Dont concurrents / partenaires possibles : ${competitors.length}`,
    "",
    ...competitors.map((row) => `- ${row.base.company_name} — ${row.verdict.competitor}`),
    "",
    "## Échecs de génération",
    "",
    ...input.measured.filter((row) => row.error).map((row) => `- ${row.name} — ${row.error}`),
    "",
    "## Trois exemples complets",
    "",
    examples || "_aucun brouillon généré_",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Entrée
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const since = new Date().toISOString();

  const { data: anyProspect } = await db.from("prospects").select("user_id").limit(1).maybeSingle();
  const userId = (anyProspect as { user_id: string } | null)?.user_id;
  if (!userId) throw new Error("aucun utilisateur : impossible de rattacher les fiches");

  // Posé AVANT tout appel payant : sans lui, `recordUnitUsage` passe par le
  // client à cookies, échoue en silence, et les coûts n'apparaissent nulle part.
  process.env.ORION_SCRIPT_USER_ID = userId;

  // La signature est posée par le code : la grille doit la retirer avant de
  // compter les mots et les liens de démo (cf. lib/segments/mail-f5.ts).
  const { loadOffer } = await import("@/lib/offer/read");
  const { signatureFor } = await import("@/lib/offer/model");
  const loaded = await loadOffer(db as never, userId);
  const signature = signatureFor(loaded.offer);

  console.log(
    `Segment Agences — zone ${ZONE}, objectif ${LIMIT} fiches${WRITE ? "" : " (SIMULATION)"}\n`,
  );
  const { kept, rejected } = await qualify(since);
  console.log(`\n${kept.length} retenues, ${rejected.length} écartées.`);

  const measured: Measured[] = [];
  // Essai nominatif : ce qu'il a donne, nommement.
  const finderWins: string[] = [];
  const finderMisses: string[] = [];
  const finderSkipped: string[] = [];

  if (WRITE) {
    for (const candidate of kept) {
      const name = candidate.base.company_name;
      console.log(`\n=== ${name}`);
      try {
        const prospectId = await upsert(candidate, userId);

        // --- Enrichissement d'agent1 : profil, faits, contact nominatif -----
        const hunterBefore = (await spend("hunter", since)).calls;
        if (hunterBefore < HUNTER_CAP) {
          const enriched = await runJob(
            userId,
            "reanalyze",
            prospectId,
            { scope: "full" },
            `Agences · ${name}`,
            180_000,
          );
          const after = (await spend("hunter", since)).calls;
          console.log(
            `  enrichissement : ${"error" in enriched ? enriched.error : "ok"} · Hunter ${after}/${HUNTER_CAP}`,
          );
        } else {
          console.log(`  enrichissement : plafond Hunter atteint (${hunterBefore}/${HUNTER_CAP})`);
        }

        const { data: fiche } = await db
          .from("prospects")
          .select("email, key_figures, business_profile")
          .eq("id", prospectId)
          .maybeSingle();
        const row = fiche as {
          email: string | null;
          key_figures: Record<string, unknown> | null;
          business_profile: Record<string, unknown> | null;
        } | null;
        const figures = row?.key_figures ?? {};
        let email = row?.email ?? null;
        let nominative =
          figures.contact_tier === "nominatif" || figures.email_type === "nominatif";

        /*
         * Essai nominatif (Cowork #3). La chaine d'agent1 cherche le dirigeant
         * SUR le domaine ; quand le site n'expose que contact@, elle ne trouve
         * rien a trouver. Le registre, lui, le nomme : on redonne ce nom a
         * `email-finder`, qui reconstruit l'adresse depuis le schema du domaine.
         * Plafond propre, et le resultat ne remplace jamais l'adresse de la
         * fiche — il est seulement mesure.
         */
        const domain = candidate.website?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? null;
        if (!nominative && domain && candidate.leaderFirst && candidate.leaderLast) {
          const used = (await spend("hunter", since)).calls;
          if (used < HUNTER_CAP + FINDER_CAP) {
            const found = await findEmailByName(domain, candidate.leaderFirst, candidate.leaderLast, prospectId);
            const hit = "data" in found ? found.data : null;
            if (hit?.email) {
              email = hit.email;
              nominative = true;
              finderWins.push(`${name} — ${candidate.leaderFirst} ${candidate.leaderLast} (score ${hit.confidence ?? "?"})`);
              console.log(`  nominatif : ${hit.email} (score ${hit.confidence ?? "?"})`);
            } else {
              finderMisses.push(`${name} — ${candidate.leaderFirst} ${candidate.leaderLast}`);
              console.log(`  nominatif : aucune adresse pour ${candidate.leaderFirst} ${candidate.leaderLast}`);
            }
          } else {
            console.log(`  nominatif : plafond finder atteint`);
          }
        } else if (!nominative) {
          finderSkipped.push(`${name} — ${!domain ? "pas de domaine" : "pas de dirigeant personne physique au registre"}`);
        }

        // --- Brouillon F5 ---------------------------------------------------
        const openai = await spend("openai", since);
        if (openai.eur >= OPENAI_CAP) {
          measured.push({
            name,
            prospectId,
            email,
            nominative,
            draft: null,
            f5: null,
            error: `plafond OpenAI atteint (${openai.eur.toFixed(3)} €)`,
          });
          console.log("  brouillon : plafond OpenAI atteint");
          continue;
        }

        const generated = await runJob(
          userId,
          "email_generate",
          prospectId,
          { tone: "direct", mode: "full", force: true, saveDraft: true, origin: "eval" },
          `Agences · ${name}`,
          240_000,
        );
        if ("error" in generated) {
          measured.push({
            name,
            prospectId,
            email,
            nominative,
            draft: null,
            f5: null,
            error: generated.error,
          });
          console.log(`  brouillon : ${generated.error}`);
          continue;
        }

        const messageId = (generated.result as { messageId?: string } | null)?.messageId;
        const { data: message } = messageId
          ? await db.from("messages").select("subject, body").eq("id", messageId).maybeSingle()
          : { data: null };
        const text = message as { subject: string | null; body: string } | null;
        if (!text) {
          measured.push({
            name,
            prospectId,
            email,
            nominative,
            draft: null,
            f5: null,
            error: "brouillon introuvable",
          });
          continue;
        }

        /*
         * Faits sourcés : ceux de la fiche quand l'enrichissement en a produit,
         * sinon le profil métier lu sur le site — le site EST la source, et son
         * URL la rend vérifiable.
         */
        const scored = Array.isArray(figures.facts)
          ? (figures.facts as { text?: string; url?: string }[]).map((fact) => ({
              label: fact.text ?? "",
              url: fact.url ?? candidate.website,
            }))
          : [];
        const profile = (row?.business_profile ?? {}) as { offer?: unknown; clients?: unknown };
        const fromSite = [profile.offer, profile.clients]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 3)
          .map((value) => ({ label: value, url: candidate.website }));
        const facts = scored.length ? scored : fromSite;
        const f5 = checkF5({ subject: text.subject ?? "", body: text.body, signature, facts });

        /*
         * Un seul juge (Cowork #3). Mes motifs ne tranchent plus que le
         * déterministe ; la lecture — fait propre à l'agence (C1, avec le test
         * de substitution de #36) et problème qui en découle (C2) — vient de la
         * check-list commune d'agent2, celle que le pipeline utilise en vrai.
         */
        const checklist = f5.ready
          ? await judgeChecklist(
              liveAsk(prospectId),
              {
                subject: text.subject ?? "",
                core: countedText(text.body, signature),
                family: "F5",
                greeting: text.body.split("\n")[0] ?? "",
                company: name,
                facts: facts.map((fact) => `- ${fact.label}`).join("\n"),
                siteText: [profile.offer, profile.clients].filter((value) => typeof value === "string").join(" · "),
              },
              "agences:checklist",
            )
          : null;

        measured.push({
          name,
          prospectId,
          email,
          nominative,
          draft: { subject: text.subject ?? "", body: text.body },
          f5,
          checklist,
          error: null,
        });
        const verdict = !f5.ready
          ? f5.failed.map((item) => item.id).join(", ")
          : checklist === null
            ? "relecture indisponible"
            : checklist.ready
              ? `prêt (check-list ${checklist.score}/10)`
              : `${checklist.items.filter((item) => !item.ok).map((item) => item.id).join(", ")} (${checklist.score}/10)`;
        console.log(`  brouillon : ${verdict}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "erreur";
        measured.push({
          name,
          prospectId: null,
          email: null,
          nominative: false,
          draft: null,
          f5: null,
          checklist: null,
          error: message,
        });
        console.log(`  erreur : ${message}`);
      }
    }
  }

  const costs: Record<string, { eur: number; calls: number }> = {};
  for (const service of ["pappers", "hunter", "openai", "linkup"]) {
    costs[service] = await spend(service, since);
  }

  mkdirSync("evals/agences", { recursive: true });
  const path = `evals/agences/report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(path, report({ kept, rejected, measured, finderWins, finderMisses, finderSkipped, costs }));
  console.log(`\n${path}`);
  for (const [service, value] of Object.entries(costs)) {
    console.log(`  ${service.padEnd(8)} ${value.calls} appel(s), ${value.eur.toFixed(4)} €`);
  }
}

/*
 * Tout le run tourne sous le contexte Linkup du segment : la part réservée
 * (LINKUP_RESERVE=agences:20) s'applique aux recherches de site de CE
 * processus, jobs compris — `withLinkupRun` passe par AsyncLocalStorage, donc
 * le contexte traverse `driveJob` sans rien changer chez agent1.
 */
withLinkupRun({ segment: "agences", cap: null, since: new Date() }, main).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
