/**
 * Évaluation de la génération d'emails.
 *
 * Rejoue la chaîne complète — analyse, rédaction, validateurs, juge — sur des
 * prospects figés, dans les 4 registres, et écrit `eval-report.md`.
 *
 * Pourquoi des fixtures plutôt que la base : un rapport doit être comparable
 * d'une exécution à l'autre. Si les données bougent, on ne sait plus si c'est
 * le prompt qui a progressé ou le prospect qui a changé.
 *
 * Exécution : `npm run eval:emails` (consomme des appels OpenAI réels).
 */
import { writeFileSync } from "node:fs";
import OpenAI from "openai";
import { buildFacts } from "@/lib/emails/derived-facts";
import { validateEmail } from "@/lib/emails/validate";
import { maxSimilarity } from "@/lib/similarity";
import { TONES, type ToneKey } from "@/lib/tones";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";
import {
  runAnalysisWithRetry,
  type DeepAnalysis,
} from "@/app/api/emails/generate/analysis";
import { buildWritingPrompt, parseEmail } from "@/app/api/emails/generate/prompt";
import {
  averageScore,
  buildCriticContext,
  buildCriticPrompt,
  CRITERIA_LABELS,
  failingCriteria,
  parseCritique,
  type Critique,
} from "@/app/api/emails/generate/critic";

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY as string });

const base = (over: Partial<Prospect>): Prospect => ({
  id: "x", user_id: "u", company_name: "", siren: null, website: null, email: null, sector: null,
  size_range: null, city: null, source: "auto", signals: [], key_figures: {}, pain_point: null,
  status: "nouveau", created_at: "", updated_at: "", ...over,
});

interface Fixture {
  prospect: Prospect;
  contact: DecisionMakerContact | null;
  site: string;
}

const FIXTURES: Fixture[] = [
  {
    prospect: base({
      id: "ras-0001",
      company_name: "RAS INTERIM JERECRUTE",
      siren: "775614308",
      website: "https://www.ras-interim.fr",
      sector: "Activités des sièges sociaux",
      size_range: "20 à 49 salariés",
      city: "Lyon",
      key_figures: { naf_code: "70.10Z", revenue_eur: 40_878_286, revenue_year: 2024, founded_year: 1969 },
    }),
    contact: null,
    site: `R.A.S Interim, agence d'interim 24h/24 et 7j/7, 190 agences en France, environ 80 000 interimaires par an depuis 1969. Placement et missions d'interim, visite de l'entreprise avant le contrat de mission, assistance administrative, entretiens de suivi. Outils : application my R.A.S (depot de CV, propositions de missions) et plateforme my Temp pour la gestion administrative. Siege a Lyon.`,
  },
  {
    prospect: base({
      id: "blue-0002",
      company_name: "BLUE ENERFREEZE",
      siren: "844104851",
      website: "https://www.blue-enerfreeze.com",
      sector: "Production et distribution de vapeur et d'air conditionné",
      size_range: "20 à 49 salariés",
      city: "Lyon",
      key_figures: { naf_code: "35.30Z", revenue_eur: 50_290_772, revenue_year: 2024, founded_year: 2018 },
    }),
    contact: {
      email: "b.dumont@blue-enerfreeze.com",
      full_name: "Benjamin Dumont",
      position: "Managing Director",
      confidence: 99,
    },
    site: `Blue EnerFreeze, producteur d'energie renouvelable et fournisseur d'energie frigorifique securisee, specialiste de la chaine du froid. Conseil en energie, production photovoltaique, securisation energetique (supervision et maintenance des installations frigorifiques), optimisation energetique. 268 points de livraison servis chaque jour, 344 GWh de consommation annuelle geree. Specialiste des operateurs de la supply chain sous temperature dirigee.`,
  },
  {
    prospect: base({
      id: "trans-0003",
      company_name: "TRANSPORTS MERCIER",
      siren: "402118745",
      website: "https://www.transports-mercier.fr",
      sector: "Transports routiers de fret interurbains",
      size_range: "50 à 99 salariés",
      city: "Saint-Étienne",
      key_figures: { naf_code: "49.41A", revenue_eur: 12_400_000, revenue_year: 2024, founded_year: 1995 },
    }),
    contact: null,
    site: `Transports Mercier, transporteur regional de lots et demi-lots, 60 vehicules, messagerie et affretement. Livraisons J+1 sur Auvergne-Rhone-Alpes. Suivi des expeditions, gestion des lettres de voiture et des litiges.`,
  },
  {
    prospect: base({
      id: "cab-0004",
      company_name: "CABINET LAURENT & ASSOCIES",
      siren: "512443901",
      website: "https://www.laurent-associes.fr",
      sector: "Activités comptables",
      size_range: "10 à 19 salariés",
      city: "Villeurbanne",
      key_figures: { naf_code: "69.20Z", revenue_eur: 1_850_000, revenue_year: 2024, founded_year: 2004 },
    }),
    contact: null,
    site: `Cabinet d'expertise comptable, 14 collaborateurs, environ 320 dossiers clients TPE et PME. Tenue, revision, bilans, paie, conseil. Portail client pour le depot des pieces comptables.`,
  },
];

async function ask(system: string, user: string, temperature: number): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return completion.choices[0]?.message?.content ?? "";
}

interface Row {
  company: string;
  tone: ToneKey;
  subject: string;
  body: string;
  failures: string[];
  critique: Critique | null;
}

(async () => {
  const rows: Row[] = [];
  const analyses = new Map<string, DeepAnalysis>();

  for (const fixture of FIXTURES) {
    const { facts } = buildFacts(fixture.prospect, fixture.contact);
    const pages = [{ url: fixture.prospect.website ?? "", markdown: fixture.site }];

    // Une analyse par prospect, reutilisee pour les 4 registres : c'est aussi
    // ce que fait le bouton « Autre angle » en production.
    const parsed = await runAnalysisWithRetry(
      (system, user, temperature) => ask(system, user, temperature),
      fixture.prospect,
      facts,
      pages,
    );
    if (!parsed.analysis) {
      console.error(`Analyse KO pour ${fixture.prospect.company_name} : ${parsed.error}`);
      continue;
    }
    analyses.set(fixture.prospect.id, parsed.analysis);

    for (const tone of TONES) {
      const email = parseEmail(
        await ask(
          buildWritingPrompt({
            tone: tone.key,
            analysis: parsed.analysis,
            facts,
            contact: fixture.contact,
            prospectId: fixture.prospect.id,
            companyName: fixture.prospect.company_name,
            avoid: rows.map((row) => row.body.split("\n")[2] ?? "").filter(Boolean).slice(-6),
          }),
          `Écris le mail pour ${fixture.prospect.company_name}.`,
          0.85,
        ),
      );
      if (!email) continue;

      const validation = validateEmail(email, {
        facts,
        contact: fixture.contact,
        tone: tone.key,
        companyName: fixture.prospect.company_name,
        siteText: fixture.site,
      });
      const critique = parseCritique(
        await ask(buildCriticPrompt(facts), buildCriticContext(parsed.analysis, email), 0),
      );

      rows.push({
        company: fixture.prospect.company_name,
        tone: tone.key,
        subject: email.subject,
        body: email.body,
        failures: validation.failures,
        critique,
      });
      console.log(`  ${fixture.prospect.company_name} / ${tone.key} — ${validation.failures.length} echec(s)`);
    }
  }

  // --- Rapport -------------------------------------------------------------
  const lines: string[] = [
    "# Évaluation de la génération d'emails",
    "",
    `Généré le ${new Date().toISOString().slice(0, 16).replace("T", " ")} · modèle \`${MODEL}\``,
    "",
    "## Synthèse",
    "",
    "| Entreprise | Ton | Objet | Validateurs | Note moyenne |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    const score = row.critique ? averageScore(row.critique).toFixed(1) : "—";
    lines.push(
      `| ${row.company} | ${row.tone} | ${row.subject} | ${row.failures.length === 0 ? "OK" : `${row.failures.length} échec(s)`} | ${score}/5 |`,
    );
  }

  // Similarite croisee entre entreprises DIFFERENTES : c'est la seule qui
  // signale un moule reutilise.
  lines.push("", "## Similarité entre entreprises différentes", "");
  let worst = 0;
  for (const row of rows) {
    const others = rows.filter((other) => other.company !== row.company).map((other) => other.body);
    const value = maxSimilarity(row.body, others);
    worst = Math.max(worst, value);
    if (value > 0.35) {
      lines.push(`- ⚠️ ${row.company} / ${row.tone} : ${(value * 100).toFixed(0)} % — au-dessus du seuil de 35 %`);
    }
  }
  lines.push(`- Maximum observé : **${(worst * 100).toFixed(0)} %** (seuil d'alerte : 35 %)`);

  lines.push("", "## Mails générés", "");
  for (const row of rows) {
    lines.push(`### ${row.company} — ton ${row.tone}`, "", `**Objet :** ${row.subject}`, "", "```", row.body, "```", "");
    lines.push(
      row.failures.length === 0
        ? "Validateurs : aucun échec."
        : `Validateurs : ${row.failures.map((failure) => `\n- ${failure}`).join("")}`,
      "",
    );
    if (row.critique) {
      lines.push("| Critère | Note | Commentaire |", "| --- | --- | --- |");
      for (const key of Object.keys(CRITERIA_LABELS) as (keyof Critique)[]) {
        lines.push(`| ${CRITERIA_LABELS[key]} | ${row.critique[key].score}/5 | ${row.critique[key].note} |`);
      }
      const failing = failingCriteria(row.critique);
      if (failing.length) lines.push("", `Sous le seuil : ${failing.length} critère(s).`);
      lines.push("");
    }
  }

  lines.push(
    "",
    "## Référence de niveau attendu",
    "",
    "Ces deux mails ont été écrits à la main comme cible de qualité. Ils ne sont",
    "PAS dans le prompt : ils servent uniquement de point de comparaison ici.",
    "",
    "**RAS — Objet : contrats de mission et relevés d'heures**",
    "",
    "```",
    "Bonjour,",
    "",
    "41 M€ de chiffre d'affaires piloté par un siège de moins de 50 personnes : dans l'intérim, ça veut dire beaucoup de contrats de mission et de relevés d'heures qui passent par très peu de mains.",
    "",
    "Je suis Axel Remillat, j'automatise ce type de flux avec de l'IA : lecture des relevés, pré-remplissage des contrats, relances automatiques côté intérimaires et côté clients.",
    "",
    "C'est un sujet chez vous en ce moment, ou c'est déjà bien outillé ?",
    "",
    "Axel",
    "```",
    "",
    "**Blue EnerFreeze — Objet : alertes, interventions et pièces**",
    "",
    "```",
    "Bonjour Benjamin,",
    "",
    "Si je lis bien votre site, Blue EnerFreeze vend de l'énergie frigorifique plutôt que des machines. Du coup, une intervention qui traîne coûte chez vous, pas chez le client.",
    "",
    "Je construis des automatisations IA, et un cas typique chez un exploitant comme vous, c'est de relier les alertes de supervision à la commande de pièces, pour que le bon composant soit déjà en route quand le technicien part.",
    "",
    "Aujourd'hui, ça se fait encore à la main chez vous ?",
    "",
    "Bonne journée,",
    "Axel",
    "```",
    "",
  );

  writeFileSync("eval-report.md", lines.join("\n"), "utf8");
  console.log(`\nRapport écrit : eval-report.md (${rows.length} mails)`);
})();
