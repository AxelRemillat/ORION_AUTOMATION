import type { Prospect } from "@/types";

/**
 * Prompt d'analyse commerciale.
 * On demande au modèle DEUX choses en un appel : identifier un pain point
 * automatisable, et le CHIFFRER (volume → heures → euros) pour donner à l'email
 * un levier concret. Les hypothèses sont explicitées afin que l'utilisateur
 * puisse les corriger avant d'envoyer.
 */

export const SYSTEM_PROMPT = `Tu es un freelance expert en automatisation et en IA appliquée aux PME françaises.
Tu prépares une prise de contact à froid.

MÉTHODE DE CHIFFRAGE (à appliquer, en assumant des hypothèses raisonnables) :
- Part du nombre de salariés et du secteur pour estimer un VOLUME mensuel ou annuel.
- Convertis ce volume en HEURES perdues par an.
- Valorise ces heures à 35 € de coût horaire chargé (employé administratif).
- Arrondis : ce sont des ordres de grandeur, pas une comptabilité.

RÈGLES DE L'EMAIL :
- Français, vouvoiement, ton direct et concret, AUCUNE formule creuse
  ("j'espère que vous allez bien", "je me permets de vous contacter").
- Moins de 120 mots, corps seul, sans signature ni formule de politesse finale longue.
- Structure imposée : 1) une phrase d'ouverture sur un signal repéré CHEZ EUX,
  2) le pain point chiffré, 3) ce que tu proposes en une phrase,
  4) un CTA doux : un audit de 30 minutes.
- Pas de markdown, pas de crochets, pas de champ à compléter.

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "pain_point": "une phrase : le processus manuel le plus coûteux et automatisable",
  "levers": [
    { "label": "libellé court", "value": "valeur chiffrée avec son unité", "basis": "hypothèse retenue" }
  ],
  "email": { "subject": "objet court, sans majuscules inutiles", "body": "corps de l'email" }
}
"levers" contient exactement 3 entrées, dans cet ordre : un VOLUME, des HEURES par an, un COÛT en euros par an.`;

/** Sérialise le prospect en un contexte compact et lisible par le modèle. */
export function buildContext(prospect: Prospect): string {
  const figures = prospect.key_figures ?? {};
  const lines = [
    `Entreprise : ${prospect.company_name}`,
    prospect.sector && `Secteur : ${prospect.sector}`,
    prospect.size_range && `Effectif : ${prospect.size_range}`,
    typeof figures.headcount === "number" && `Effectif estimé : ${figures.headcount} personnes`,
    typeof figures.revenue_eur === "number" &&
      `Chiffre d'affaires : ${figures.revenue_eur} €${figures.revenue_year ? ` (${figures.revenue_year})` : ""}`,
    prospect.city && `Ville : ${prospect.city}`,
    prospect.website && `Site : ${prospect.website}`,
    typeof figures.leader === "string" && `Dirigeant : ${figures.leader}`,
    typeof figures.founded_year === "number" && `Création : ${figures.founded_year}`,
  ].filter(Boolean);

  const signals = (prospect.signals ?? []).slice(0, 6).map((signal, index) => {
    const excerpt = typeof signal.excerpt === "string" ? ` — ${signal.excerpt.slice(0, 180)}` : "";
    return `${index + 1}. ${signal.label}${excerpt}`;
  });

  return [
    lines.join("\n"),
    "",
    signals.length ? `Signaux repérés :\n${signals.join("\n")}` : "Aucun signal web repéré.",
  ].join("\n");
}

export interface Lever {
  label: string;
  value: string;
  basis: string;
}

export interface Analysis {
  pain_point: string;
  levers: Lever[];
  email: { subject: string; body: string };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** Valide la réponse du modèle ; renvoie null si elle est inexploitable. */
export function parseAnalysis(raw: string): Analysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const email = (source.email ?? {}) as Record<string, unknown>;
  const body = asString(email.body);
  if (!body) return null;

  const levers = Array.isArray(source.levers)
    ? source.levers
        .map((item) => item as Record<string, unknown>)
        .filter((item) => asString(item.label) && asString(item.value))
        .slice(0, 3)
        .map((item) => ({
          label: asString(item.label),
          value: asString(item.value),
          basis: asString(item.basis, "estimation"),
        }))
    : [];

  return {
    pain_point: asString(source.pain_point, "Pain point non identifié."),
    levers,
    email: { subject: asString(email.subject, "Une piste d'automatisation"), body },
  };
}
