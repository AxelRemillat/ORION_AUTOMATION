import { utcToParis } from "@/lib/outbox/paris-time";
import { openAiMonthlyCap, pappersDailyBudget } from "@/lib/usage/budgets";

/**
 * Réglages › Coûts — détail par fournisseur et par mois (heure de Paris), et
 * budgets en vigueur. Code pur.
 */

export const COST_PROVIDERS = ["openai", "hunter", "pappers", "linkup"] as const;
export type CostProvider = (typeof COST_PROVIDERS)[number];

export interface MonthRow {
  /** AAAA-MM */
  month: string;
  label: string;
  byProvider: Record<CostProvider, { eur: number; calls: number }>;
  total: number;
}

export function monthlyCosts(
  rows: readonly { service: string; cost: number | string | null; created_at: string }[],
  months = 6,
  now = new Date(),
): MonthRow[] {
  const current = utcToParis(now).date.slice(0, 7);
  const keys: string[] = [];
  for (let index = months - 1; index >= 0; index -= 1) {
    const [year, month] = [Number(current.slice(0, 4)), Number(current.slice(5, 7))];
    keys.push(new Date(Date.UTC(year, month - 1 - index, 1)).toISOString().slice(0, 7));
  }
  const table = new Map(
    keys.map((key) => [
      key,
      Object.fromEntries(COST_PROVIDERS.map((provider) => [provider, { eur: 0, calls: 0 }])) as MonthRow["byProvider"],
    ]),
  );
  for (const row of rows) {
    if (!(COST_PROVIDERS as readonly string[]).includes(row.service)) continue;
    const month = utcToParis(new Date(row.created_at)).date.slice(0, 7);
    const cell = table.get(month)?.[row.service as CostProvider];
    if (!cell) continue;
    cell.eur += Number(row.cost) || 0;
    cell.calls += 1;
  }
  return keys
    .map((month) => {
      const byProvider = table.get(month)!;
      for (const provider of COST_PROVIDERS) byProvider[provider].eur = Math.round(byProvider[provider].eur * 100) / 100;
      const total = Math.round(COST_PROVIDERS.reduce((sum, provider) => sum + byProvider[provider].eur, 0) * 100) / 100;
      const label = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
      return { month, label, byProvider, total };
    })
    .reverse();
}

export interface Budget {
  label: string;
  value: string;
  source: string;
}

/** Budgets et forfaits en vigueur, tels que l'app les applique (noms de variables, jamais de valeur secrète). */
export function budgets(
  env: Record<string, string | undefined>,
  hunterDaily: number,
  live: { pappersUsedToday?: number | null; openai?: { spent: number; cap: number; ratio: number } | null } = {},
): Budget[] {
  const hunterEur = Number(env.HUNTER_SEARCH_EUR);
  const pappersEur = Number(env.PAPPERS_CREDIT_EUR);
  const pappersDaily = pappersDailyBudget(env);
  const openaiCap = openAiMonthlyCap(env);
  const euros = (value: number) => `${value.toFixed(2).replace(".", ",")} €`;
  return [
    { label: "Hunter — recherches par jour", value: hunterDaily === 0 ? "coupé" : String(hunterDaily), source: "HUNTER_DAILY_BUDGET" },
    { label: "Hunter — forfait", value: "2 000 crédits / mois, remis à zéro le 2", source: "Starter" },
    { label: "Hunter — prix d'une recherche", value: hunterEur > 0 ? `${hunterEur} €` : "non renseigné", source: "HUNTER_SEARCH_EUR" },
    {
      label: "Pappers — plafond par jour",
      value: pappersDaily === 0
        ? "coupé"
        : `${pappersDaily} crédits${live.pappersUsedToday != null ? ` · ${live.pappersUsedToday} utilisés aujourd'hui` : ""}`,
      source: "PAPPERS_DAILY_BUDGET (défaut 40, minuit Paris)",
    },
    { label: "Pappers — forfait", value: `${env.PAPPERS_PLAN_CREDITS ?? "500"} crédits / mois`, source: "PAPPERS_PLAN_CREDITS" },
    { label: "Pappers — prix d'un crédit", value: pappersEur > 0 ? `${pappersEur} €` : "non renseigné", source: "PAPPERS_CREDIT_EUR" },
    {
      label: "OpenAI — plafond mensuel",
      value: `${euros(openaiCap)}${live.openai ? ` · ${euros(live.openai.spent)} dépensés (${Math.round(live.openai.ratio * 100)} %)` : ""}`,
      source: "OPENAI_MONTHLY_BUDGET_EUR (défaut 15 €) · alerte à 80 %, préparation arrêtée à 100 %",
    },
  ];
}
