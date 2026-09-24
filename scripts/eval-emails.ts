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
import { bodyParagraphs, validateEmail } from "@/lib/emails/validate";
import { PERSONA } from "@/lib/persona";
import { maxSimilarity } from "@/lib/similarity";
import { TONES, type ToneKey } from "@/lib/tones";
import type { DecisionMakerContact } from "@/lib/enrichment/types";
import type { Prospect } from "@/types";
import {
  runAnalysisWithRetry,
  type DeepAnalysis,
} from "@/app/api/emails/generate/analysis";
import { buildWritingPrompt, parseEmail, planFor } from "@/app/api/emails/generate/prompt";
import {
  averageScore,
  buildCriticContext,
  buildCriticPrompt,
  CRITERIA_LABELS,
  failingCriteria,
  parseCritique,
  type Critique,
} from "@/app/api/emails/generate/critic";

const PUBLIC_PROOFS = PERSONA.proofs.filter((proof) => proof.publicOk).map((proof) => proof.text);

const NEWLINE = "\n";

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
      key_figures: {
        naf_code: "35.30Z",
        revenue_eur: 50_290_772,
        revenue_year: 2024,
        founded_year: 2018,
        parent_company: "STEF",
      },
      // Les deux faits qui doivent primer sur les finances : un recrutement
      // d'automaticien recent (rang 1) et l'appartenance au groupe (rang 2).
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote: "Blue EnerFreeze recrute un automaticien H/F en CDI pour ses installations frigorifiques",
          url: "https://www.blue-enerfreeze.com/carrieres",
          date: new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10),
          confidence: 0.9,
        },
      ],
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
  {
    // Distributeur d'aciers inoxydables. Les montants viennent des comptes
    // publies ; le texte de site est resume a la main a partir de leurs pages
    // publiques, comme pour les autres fixtures.
    prospect: base({
      id: "jacquet-0005",
      company_name: "JACQUET METAL SERVICE",
      siren: "306159762",
      website: "https://www.jacquetmetalservice.com",
      sector: "Commerce de gros de minerais et métaux",
      size_range: "100 à 199 salariés",
      city: "Saint-Priest",
      key_figures: {
        naf_code: "46.72Z",
        revenue_eur: 214_600_000,
        revenue_year: 2024,
        founded_year: 1962,
        parent_company: "JACQUET METALS",
      },
      signals: [
        {
          type: "recrutement",
          label: "Recrutement en cours",
          quote:
            "Jacquet Metal Service recrute un technicien méthodes / ordonnancement pour son site de Saint-Priest (CDI)",
          url: "https://www.jacquetmetalservice.com/carrieres",
          date: new Date(Date.now() - 18 * 86_400_000).toISOString().slice(0, 10),
          confidence: 0.85,
        },
      ],
    }),
    contact: null,
    site: `Jacquet Metal Service, distributeur de toles et produits en acier inoxydable et aluminium. Stock permanent, decoupe a la demande (sciage, oxycoupage, jet d'eau), livraison sous 24 a 48 heures depuis un reseau d'agences. Devis a la piece, bulletins de matiere et certificats 3.1 fournis avec chaque commande. Filiale du groupe Jacquet Metals.`,
  },
];

/**
 * Filtres d'execution, pour rejouer une cible sans repayer tout le rapport.
 *
 *   EVAL_ONLY="ras,blue,jacquet"  EVAL_TONES="direct"  npm run eval:emails
 */
const only = (process.env.EVAL_ONLY ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
const toneFilter = (process.env.EVAL_TONES ?? "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);

const SELECTED = only.length
  ? FIXTURES.filter((fixture) => only.some((needle) => fixture.prospect.id.toLowerCase().includes(needle)))
  : FIXTURES;
const SELECTED_TONES = toneFilter.length
  ? TONES.filter((tone) => toneFilter.includes(tone.key))
  : TONES;

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
  plan: "A" | "B" | "C";
  /** Le premier jet a-t-il ete remplace par la reecriture ? */
  rewritten: boolean;
  subject: string;
  body: string;
  failures: string[];
  critique: Critique | null;
}

(async () => {
  const rows: Row[] = [];
  const analyses = new Map<string, DeepAnalysis>();

  for (const fixture of SELECTED) {
    const { facts } = buildFacts(fixture.prospect, fixture.contact, new Date(), fixture.site);
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

    for (const tone of SELECTED_TONES) {
      const writingInput = {
        tone: tone.key,
        analysis: parsed.analysis,
        facts,
        contact: fixture.contact,
        prospectId: fixture.prospect.id,
        companyName: fixture.prospect.company_name,
        avoid: rows.map((row) => row.body.split("\n")[2] ?? "").filter(Boolean).slice(-6),
      };
      const plan = planFor(writingInput);

      const email = parseEmail(
        await ask(
          buildWritingPrompt(writingInput),
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
        proofs: PUBLIC_PROOFS,
        plan,
      });
      const critique = parseCritique(
        await ask(buildCriticPrompt(facts, PUBLIC_PROOFS), buildCriticContext(parsed.analysis, email), 0),
      );

      // UNE reecriture, exactement comme la route : un rapport qui s'arrete au
      // premier jet ne dit rien de ce que l'utilisateur voit a l'ecran.
      let finalEmail = email;
      let finalValidation = validation;
      let finalCritique = critique;
      let rewritten = false;
      const failing = critique ? failingCriteria(critique) : [];

      if (!validation.ok || failing.length > 0) {
        const feedback = [...validation.failures, ...failing].map((line) => `- ${line}`).join(NEWLINE);
        const second = parseEmail(
          await ask(
            buildWritingPrompt({ ...writingInput, critique: feedback }),
            `Réécris le mail pour ${fixture.prospect.company_name}.`,
            0.75,
          ),
        );
        if (second) {
          const secondValidation = validateEmail(second, {
            facts,
            contact: fixture.contact,
            tone: tone.key,
            companyName: fixture.prospect.company_name,
            proofs: PUBLIC_PROOFS,
            plan,
          });
          const secondCritique = parseCritique(
            await ask(buildCriticPrompt(facts, PUBLIC_PROOFS), buildCriticContext(parsed.analysis, second), 0),
          );
          const secondFailing = secondCritique ? failingCriteria(secondCritique) : [];
          if (secondValidation.failures.length + secondFailing.length < validation.failures.length + failing.length) {
            finalEmail = second;
            finalValidation = secondValidation;
            finalCritique = secondCritique;
            rewritten = true;
          }
        }
      }

      rows.push({
        company: fixture.prospect.company_name,
        tone: tone.key,
        plan,
        rewritten,
        subject: finalEmail.subject,
        body: finalEmail.body,
        failures: finalValidation.failures,
        critique: finalCritique,
      });
      console.log(
        `  ${fixture.prospect.company_name} / ${tone.key} — ${finalValidation.failures.length} echec(s)` +
          `${rewritten ? " (apres reecriture)" : ""}`,
      );
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
    "| Entreprise | Ton | Plan | Objet | Réécrit | Validateurs | Note moyenne |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    const score = row.critique ? averageScore(row.critique).toFixed(1) : "—";
    lines.push(
      `| ${row.company} | ${row.tone} | ${row.plan} | ${row.subject} | ${row.rewritten ? "oui" : "non"} | ${row.failures.length === 0 ? "OK" : `${row.failures.length} échec(s)`} | ${score}/5 |`,
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

  // Mots d'ouverture de paragraphe : la similarite globale ne les voit pas.
  // Deux mails peuvent partager 0 % de vocabulaire et commencer tous leurs
  // paragraphes par « Si », « Je » et « C'est » — c'est le squelette qui est
  // recopie, et ca se sent a la lecture bien avant les mots.
  lines.push("", "## Squelette : premiers mots des paragraphes", "");
  const skeleton = (body: string): string =>
    bodyParagraphs(body)
      .map((block) => (block.split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-zà-ÿ']/g, ""))
      .join(" · ");

  const seen = new Map<string, string[]>();
  for (const row of rows) {
    const key = skeleton(row.body);
    if (!key) continue;
    seen.set(key, [...(seen.get(key) ?? []), `${row.company} / ${row.tone} (plan ${row.plan})`]);
  }
  let repeated = 0;
  for (const [key, owners] of seen) {
    const companies = new Set(owners.map((owner) => owner.split(" / ")[0]));
    if (companies.size < 2) continue;
    repeated += 1;
    lines.push(`- ⚠️ ouverture identique « ${key} » : ${owners.join(", ")}`);
  }
  lines.push(
    repeated === 0
      ? "- Aucune entreprise ne partage la suite de ses mots d'ouverture."
      : `- ${repeated} squelette(s) partagé(s) entre entreprises différentes.`,
  );

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
