import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";
import { DEFAULT_EXCLUDED_SECTORS, DEFAULT_PREFERRED_SECTORS } from "./filter";
import { clampDigLimit, DEFAULT_DIG_LIMIT } from "./dig";
import { DEFAULT_FUNNEL_DAYS } from "./harvest";

/** Réglages de l'entonnoir, avec les défauts du brief. */
export interface FunnelPrefs {
  departements: string[];
  preferredSectors: string[];
  excludedSectors: string[];
  days: number;
  digLimit: number;
  daily: boolean;
}

export const DEFAULT_PREFS: FunnelPrefs = {
  departements: [],
  preferredSectors: [...DEFAULT_PREFERRED_SECTORS],
  excludedSectors: [...DEFAULT_EXCLUDED_SECTORS],
  days: DEFAULT_FUNNEL_DAYS,
  digLimit: DEFAULT_DIG_LIMIT,
  daily: false,
};

const DEPARTEMENT = /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$/i;
const NAF_PREFIX = /^[0-9]{2}[0-9A-Z]{0,3}$/i;

const list = (value: unknown, pattern: RegExp, max: number) =>
  Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim().toUpperCase().replace(/\./g, "")).filter((item) => pattern.test(item)))].slice(0, max)
    : null;

/** Nettoie une saisie : seuls les champs valides remplacent les défauts. */
export function cleanPrefs(input: Record<string, unknown>, base: FunnelPrefs = DEFAULT_PREFS): FunnelPrefs {
  const days = Math.floor(Number(input.days));
  return {
    departements: list(input.departements, DEPARTEMENT, 10) ?? base.departements,
    preferredSectors: list(input.preferredSectors, NAF_PREFIX, 60) ?? base.preferredSectors,
    excludedSectors: list(input.excludedSectors, NAF_PREFIX, 60) ?? base.excludedSectors,
    days: Number.isFinite(days) ? Math.max(1, Math.min(90, days)) : base.days,
    digLimit: input.digLimit === undefined ? base.digLimit : clampDigLimit(input.digLimit),
    daily: typeof input.daily === "boolean" ? input.daily : base.daily,
  };
}

export async function readPrefs(db: SupabaseClient<Database>, userId: string): Promise<FunnelPrefs> {
  const { data } = await db.from("funnel_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!data) return DEFAULT_PREFS;
  return cleanPrefs({
    departements: data.departements,
    preferredSectors: data.preferred_sectors,
    excludedSectors: data.excluded_sectors,
    days: data.days,
    digLimit: data.dig_limit,
    daily: data.daily,
  });
}

export async function writePrefs(db: SupabaseClient<Database>, userId: string, prefs: FunnelPrefs) {
  const { error } = await db.from("funnel_settings").upsert(
    {
      user_id: userId,
      departements: prefs.departements,
      preferred_sectors: prefs.preferredSectors,
      excluded_sectors: prefs.excludedSectors,
      days: prefs.days,
      dig_limit: prefs.digLimit,
      daily: prefs.daily,
    },
    { onConflict: "user_id" },
  );
  return error ? { error: error.message } : { ok: true as const };
}
