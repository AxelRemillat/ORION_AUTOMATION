import type { DailyRow } from "./consumption";

/**
 * Lecture de la consommation DÉJÀ AGRÉGÉE par la base (vues
 * `api_usage_daily` et `free_api_calls_daily`, migration 20261012153000).
 *
 * Pourquoi : `api_usage` compte 12 076 lignes sur 30 jours (mesure du
 * 12/10/2026). PostgREST plafonnant une réponse à 1 000 lignes, le Cockpit
 * enchaînait 14 aller-retours pour refaire en JavaScript le `group by` que
 * Postgres fait en une fois — 1,6 s par affichage.
 *
 * Ces vues sont EXACTES, pas un cache : elles agrègent à la lecture. Un appel
 * journalisé à l'instant y figure aussitôt, ce qui permet aussi aux compteurs
 * de plafond de s'en servir sans perdre leur exactitude.
 *
 * `null` quand la vue n'existe pas encore (migration pas encore appliquée au
 * moment où le code arrive en prod) : l'appelant retombe alors sur la lecture
 * ligne à ligne, plus lente mais identique.
 */

type Reader = { from: (table: string) => any };

/**
 * Entre le déploiement du code et l'application de la migration, ces vues
 * n'existent pas : on se souvient de leur absence une minute pour ne pas payer
 * deux requêtes perdues à chaque affichage. Jamais de mémoire d'un SUCCÈS —
 * les chiffres, eux, sont toujours relus.
 */
const MISSING_MEMO_MS = 60_000;
const missingSince = new Map<string, number>();

const isKnownMissing = (view: string, now: number) => (now - (missingSince.get(view) ?? 0)) < MISSING_MEMO_MS;

/** Une erreur de lecture (vue absente, droits) vaut `null` : l'appelant a un repli. */
async function readView(db: Reader, view: string, columns: string, fromDay: string): Promise<DailyRow[] | null> {
  const now = Date.now();
  if (isKnownMissing(view, now)) return null;
  const { data, error } = await db.from(view).select(columns).gte("day", fromDay).order("day");
  if (error) {
    missingSince.set(view, now);
    return null;
  }
  missingSince.delete(view);
  return (data ?? []) as DailyRow[];
}

/** Journées payantes (OpenAI, Hunter, Pappers, Linkup) depuis un jour de Paris inclus. */
export const readDailyUsage = (db: unknown, fromDay: string): Promise<DailyRow[] | null> =>
  readView(db as Reader, "api_usage_daily", "day, service, calls, eur, units", fromDay);

/** Journées gratuites (INPI…) : coût nul par construction. */
export const readDailyFree = (db: unknown, fromDay: string): Promise<DailyRow[] | null> =>
  readView(db as Reader, "free_api_calls_daily", "day, service, calls, units", fromDay);

/**
 * Somme exacte d'une colonne pour UN service depuis un jour de Paris inclus,
 * en une seule requête. `null` si la vue manque.
 *
 * Les bornes des plafonds (minuit à Paris, 1er du mois à Paris) tombent sur des
 * frontières de jour : agréger par jour ne perd donc rien.
 */
export async function sumDaily(
  db: unknown,
  service: string,
  fromDay: string,
  column: "eur" | "units",
): Promise<number | null> {
  const now = Date.now();
  if (isKnownMissing("api_usage_daily", now)) return null;
  const { data, error } = await (db as Reader)
    .from("api_usage_daily")
    .select(`day, service, ${column}`)
    .eq("service", service)
    .gte("day", fromDay);
  if (error) {
    missingSince.set("api_usage_daily", now);
    return null;
  }
  missingSince.delete("api_usage_daily");
  return ((data ?? []) as Record<string, unknown>[]).reduce((total, row) => total + (Number(row[column]) || 0), 0);
}

/** Pour les tests : oublie ce qu'on croit savoir de l'existence des vues. */
export const resetDailyViewMemo = (): void => void missingSince.clear();
