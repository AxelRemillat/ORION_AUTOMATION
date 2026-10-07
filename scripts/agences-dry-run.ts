/**
 * MESURE À BLANC du segment « Agences » — aucun envoi, jamais.
 *
 * À LANCER EN LOCAL (agent VS Code) : lit `.env.local`, consomme des appels
 * PAYANTS (Linkup pour trouver les sites, Hunter pour les contacts, OpenAI pour
 * les brouillons). Deux plafonds sont tenus et affichés : crédits Hunter et
 * dépense OpenAI.
 *
 *   npm run dry:agences                      (simulation : rien n'est écrit)
 *   npm run dry:agences -- --write           (crée les fiches et les brouillons)
 *   npm run dry:agences -- --zone 69 --limit 10 --hunter-cap 15 --openai-cap 1
 *
 * Les brouillons sont marqués `origin: "eval"` : ils existent et sont
 * mesurables, mais n'entrent PAS dans la file « Aujourd'hui » — aucun risque
 * qu'un envoi part par accident.
 *
 * Rapport : evals/agences/report-AAAA-MM-JJ.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { AGENCES_EFFECTIF_CODES, AGENCES_NAF, classifyAgence } from "@/lib/segments/agences";
import { segmentMarks } from "@/lib/segments";
import { checkF5, type F5Verdict } from "@/lib/segments/mail-f5";
import { coverSite } from "@/lib/enrichment/site";
import { searchCompanies } from "@/lib/enrichment/gouv";
import type { CompanyBase } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";

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
const OPENAI_CAP = Number(flag("openai-cap", "1")) || 1;
/** Candidats examinés au plus : chacun peut coûter une recherche Linkup. */
const SCAN_WIDTH = Number(flag("scan", "24")) || 24;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");
const db = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Coûts réels, lus dans api_usage
// ---------------------------------------------------------------------------

async function spend(service: string, since: string): Promise<{ eur: number; calls: number }> {
  const { data } = await db
    .from("api_usage")
    .select("cost, service, created_at")
    .gte("created_at", since)
    .eq("service", service);
  const rows = (data ?? []) as { cost: number }[];
  return { eur: rows.reduce((total, row) => total + (Number(row.cost) || 0), 0), calls: rows.length };
}

// ---------------------------------------------------------------------------
// Phase 1 — candidats gratuits, puis qualification par le site
// ---------------------------------------------------------------------------

interface Candidate {
  base: CompanyBase;
  website: string | null;
  siteStatus: string;
  verdict: ReturnType<typeof classifyAgence>;
}

/**
 * Codes NAF par ordre de RENDEMENT attendu : les agences de publicité et de
 * communication d'abord, les codes informatiques ensuite — ils contiennent
 * autant d'éditeurs de logiciels et d'ESN que d'agences.
 */
const NAF_ORDER = ["73.11Z", "70.21Z", "74.10Z", "62.01Z", "62.02A"] as const;

async function qualify(): Promise<{ kept: Candidate[]; rejected: Candidate[] }> {
  const candidates: CompanyBase[] = [];
  let total = 0;

  for (const naf of NAF_ORDER) {
    if (candidates.length >= SCAN_WIDTH) break;
    const search = await searchCompanies(
      { naf: [naf], tranches: [...AGENCES_EFFECTIF_CODES], zone: ZONE },
      25,
    );
    if (!search.ok) {
      console.log(`  (${naf} : ${search.error})`);
      continue;
    }
    total += search.data.total;
    const room = SCAN_WIDTH - candidates.length;
    const page = search.data.companies.slice(0, room);
    console.log(`  ${naf} ${AGENCES_NAF[naf]} : ${search.data.total} en zone ${ZONE}, ${page.length} examinées`);
    candidates.push(...page);
  }

  console.log(`\nAnnuaire : ${total} entreprises dans le vivier, ${candidates.length} examinées\n`);

  const kept: Candidate[] = [];
  const rejected: Candidate[] = [];

  for (const base of candidates) {
    if (kept.length >= LIMIT) break;

    const site = await coverSite({
      name: base.company_name,
      siren: base.siren,
      city: base.city,
      postalCode: base.postal_code,
      knownWebsite: base.website,
      contactEmail: base.email,
    });

    const verdict = classifyAgence({
      naf: base.naf_code,
      effectifCode: base.figures.effectif_code,
      siteText: site.pages.map((page) => page.text).join("\n") || null,
      companyName: base.company_name,
      website: site.url,
    });

    const row: Candidate = { base, website: site.url, siteStatus: site.status, verdict };
    if (verdict.fit === "dedans") {
      kept.push(row);
      console.log(`  ✓ ${base.company_name} — ${verdict.signals.join(", ")}`);
    } else {
      rejected.push(row);
      const why = site.note
        ? ` [site ${site.status} : ${site.note}]`
        : ` [site ${site.status}${site.discoveredBy ? `, via ${site.discoveredBy}` : ""}]`;
      console.log(`  · ${base.company_name} — ${verdict.reason ?? "hors segment"}${why}`);
    }
  }
  return { kept, rejected };
}

// ---------------------------------------------------------------------------
// Phase 2 — fiches, contacts, brouillons
// ---------------------------------------------------------------------------

interface Measured {
  name: string;
  prospectId: string | null;
  email: string | null;
  contactName: string | null;
  nominative: boolean;
  draft: { subject: string; body: string } | null;
  f5: F5Verdict | null
  error: string | null;
}

async function upsert(candidate: Candidate, userId: string): Promise<string> {
  const marks = segmentMarks(candidate.verdict);
  const payload = {
    user_id: userId,
    company_name: candidate.base.company_name,
    siren: candidate.base.siren,
    website: candidate.website,
    sector: candidate.base.sector,
    size_range: candidate.base.size_range,
    city: candidate.base.city,
    source: "auto" as const,
    status: "nouveau" as const,
    signals: [],
    key_figures: {
      ...marks,
      naf_code: candidate.base.naf_code ?? undefined,
      effectif_code: candidate.base.figures.effectif_code ?? undefined,
      site_status: candidate.siteStatus,
    },
  };

  const { data: existing } = await db
    .from("prospects")
    .select("id")
    .eq("user_id", userId)
    .eq("siren", candidate.base.siren ?? "")
    .maybeSingle();

  if (existing) {
    const id = (existing as { id: string }).id;
    await db.from("prospects").update({ key_figures: payload.key_figures, website: payload.website }).eq("id", id);
    return id;
  }
  const { data, error } = await db.from("prospects").insert(payload as never).select("id").single();
  if (error) throw new Error(`fiche non créée : ${error.message}`);
  return (data as { id: string }).id;
}

async function draftFor(prospectId: string, userId: string, label: string): Promise<{ subject: string; body: string } | { error: string }> {
  process.env.ORION_SCRIPT_USER_ID = userId;
  const { HANDLERS } = await import("@/lib/jobs/handlers");
  const { driveJob } = await import("@/lib/jobs/runner");
  const { EMPTY_PROGRESS } = await import("@/lib/jobs/types");

  const { data: job, error } = await db
    .from("jobs")
    .insert({
      user_id: userId,
      type: "email_generate",
      target: { prospectId, label: `Agences · ${label}`.slice(0, 160) },
      // origin « eval » : le brouillon existe et se mesure, mais reste hors de
      // « Aujourd'hui » — aucun envoi ne peut partir par accident.
      params: { prospectId, tone: "direct", mode: "full", force: true, saveDraft: true, origin: "eval" },
      status: "queued",
      progress: EMPTY_PROGRESS,
    } as never)
    .select("id")
    .single();
  if (error || !job) return { error: `job non créé : ${error?.message}` };

  const final = await driveJob(db as never, (job as { id: string }).id, HANDLERS, 180_000);
  if (!final || final.status !== "done") return { error: `génération : ${final?.error ?? final?.status ?? "sans réponse"}` };
  const messageId = (final.result as { messageId?: string } | null)?.messageId;
  if (!messageId) return { error: "brouillon non enregistré" };

  const { data: message } = await db.from("messages").select("subject, body").eq("id", messageId).maybeSingle();
  const row = message as { subject: string | null; body: string } | null;
  return row ? { subject: row.subject ?? "", body: row.body } : { error: "brouillon introuvable" };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function report(input: {
  kept: Candidate[];
  rejected: Candidate[];
  measured: Measured[];
  costs: { hunter: { eur: number; calls: number }; openai: { eur: number; calls: number }; linkup: { eur: number; calls: number } };
}): string {
  const total = input.measured.length;
  const nominative = input.measured.filter((row) => row.nominative).length;
  const ready = input.measured.filter((row) => row.f5?.ready).length;
  const drafted = input.measured.filter((row) => row.draft).length;
  const pct = (part: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");

  const examples = input.measured
    .filter((row) => row.draft)
    .slice(0, 3)
    .map(
      (row) =>
        [
          `### ${row.name}`,
          "",
          `- contact : ${row.email ?? "aucun"}${row.contactName ? ` (${row.contactName})` : ""}`,
          `- grille F5 : ${row.f5?.ready ? "complète" : (row.f5?.failed ?? []).map((item) => `${item.id} (${item.detail})`).join(" · ")}`,
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
    `| Contact nominatif | ${pct(nominative)} | ${nominative}/${total} |`,
    `| Brouillon F5 généré | ${pct(drafted)} | ${drafted}/${total} |`,
    `| Mail prêt (grille F5 complète) | ${pct(ready)} | ${ready}/${total} |`,
    "",
    "## Coûts réels (api_usage)",
    "",
    "| Service | Appels | Coût |",
    "| --- | --- | --- |",
    `| Hunter | ${input.costs.hunter.calls} / ${HUNTER_CAP} | ${input.costs.hunter.eur.toFixed(4)} € |`,
    `| OpenAI | ${input.costs.openai.calls} | ${input.costs.openai.eur.toFixed(4)} € (plafond ${OPENAI_CAP} $) |`,
    `| Linkup | ${input.costs.linkup.calls} | ${input.costs.linkup.eur.toFixed(4)} € |`,
    "",
    "## Écartées",
    "",
    ...input.rejected.map((row) => `- ${row.base.company_name} — ${row.verdict.reason ?? "hors segment"}`),
    "",
    `### Dont concurrents / partenaires possibles : ${competitors.length}`,
    "",
    ...competitors.map((row) => `- ${row.base.company_name} — ${row.verdict.competitor}`),
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
  console.log(`Segment Agences — zone ${ZONE}, objectif ${LIMIT} fiches${WRITE ? "" : " (SIMULATION)"}\n`);
  const { kept, rejected } = await qualify();
  console.log(`\n${kept.length} retenues, ${rejected.length} écartées.`);

  const measured: Measured[] = [];
  if (!WRITE) {
    for (const candidate of kept) {
      measured.push({
        name: candidate.base.company_name,
        prospectId: null,
        email: null,
        contactName: null,
        nominative: false,
        draft: null,
        f5: null,
        error: "simulation : --write absent",
      });
    }
  } else {
    const { findContact } = await import("@/lib/contact-finder");
    let hunterUsed = (await spend("hunter", since)).calls;

    for (const candidate of kept) {
      const name = candidate.base.company_name;
      try {
        const prospectId = await upsert(candidate, userId);
        console.log(`\n=== ${name}`);

        let email: string | null = null;
        let contactName: string | null = null;
        let nominative = false;
        if (hunterUsed < HUNTER_CAP) {
          const contact = await findContact(prospectId, { db: db as never, userId });
          hunterUsed = (await spend("hunter", since)).calls;
          email = contact.email ?? null;
          contactName = contact.found_by ?? null;
          // « nominatif » au sens d'ORION : l'adresse désigne une personne,
          // pas une boîte de service (contact@, info@).
          nominative = contact.email_type === "nominatif";
          console.log(`  contact : ${email ?? "aucun"}${nominative ? " (nominatif)" : ""} · Hunter ${hunterUsed}/${HUNTER_CAP}`);
        } else {
          console.log(`  contact : plafond Hunter atteint (${hunterUsed}/${HUNTER_CAP})`);
        }

        const openai = await spend("openai", since);
        if (openai.eur >= OPENAI_CAP) {
          measured.push({ name, prospectId, email, contactName, nominative, draft: null, f5: null, error: `plafond OpenAI atteint (${openai.eur.toFixed(3)} €)` });
          console.log(`  brouillon : plafond OpenAI atteint`);
          continue;
        }

        const draft = await draftFor(prospectId, userId, name);
        if ("error" in draft) {
          measured.push({ name, prospectId, email, contactName, nominative, draft: null, f5: null, error: draft.error });
          console.log(`  brouillon : ${draft.error}`);
          continue;
        }

        const { data: fiche } = await db.from("prospects").select("key_figures").eq("id", prospectId).maybeSingle();
        const figures = ((fiche as { key_figures?: Record<string, unknown> } | null)?.key_figures ?? {}) as Record<string, unknown>;
        const facts = Array.isArray(figures.facts)
          ? (figures.facts as { text?: string; url?: string }[]).map((fact) => ({ label: fact.text ?? "", url: fact.url ?? null }))
          : [];
        const f5 = checkF5({ subject: draft.subject, body: draft.body, facts });
        measured.push({ name, prospectId, email, contactName, nominative, draft, f5, error: null });
        console.log(`  brouillon : ${f5.ready ? "grille F5 complète" : f5.failed.map((item) => item.id).join(", ")}`);
      } catch (error) {
        measured.push({ name, prospectId: null, email: null, contactName: null, nominative: false, draft: null, f5: null, error: error instanceof Error ? error.message : "erreur" });
        console.log(`  erreur : ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  const costs = {
    hunter: await spend("hunter", since),
    openai: await spend("openai", since),
    linkup: await spend("linkup", since),
  };

  mkdirSync("evals/agences", { recursive: true });
  const path = `evals/agences/report-${new Date().toISOString().slice(0, 10)}.md`;
  writeFileSync(path, report({ kept, rejected, measured, costs }));
  console.log(`\n${path}`);
  console.log(
    `Coûts : Hunter ${costs.hunter.calls} appel(s), OpenAI ${costs.openai.eur.toFixed(4)} €, Linkup ${costs.linkup.eur.toFixed(4)} €`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
