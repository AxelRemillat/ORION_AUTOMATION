import { cached } from "./cache";
import { resolveCompany } from "./gouv";
import { effectifFloor } from "./naf";
import { fetchHoldingProfile, type HoldingProfile } from "./pappers";

/**
 * HOLDING via l'ANNUAIRE GRATUIT (API Recherche d'entreprises), 05/10/2026 :
 * dirigeant personne physique de la holding, tranche d'effectif, CA publié.
 * C'est ce qu'il faut pour la salutation (« via HOLDING ») et pour la règle
 * d'exclusion « filiale d'un groupe de plus de 250 salariés ou 50 M€ ».
 *
 * Pappers n'est appelé QUE si l'annuaire ne publie ni tranche d'effectif ni CA
 * pour la holding : sans chiffre, la règle d'exclusion ne peut pas trancher.
 * Mis en cache 30 jours (une holding détient souvent plusieurs cibles).
 */

export interface HoldingRead {
  profile: HoldingProfile;
  /** Crédits Pappers réellement dépensés pour la lire (0 si l'annuaire a suffi). */
  pappersCalls: number;
  source: "annuaire" | "pappers";
}

type Deps = {
  resolve?: typeof resolveCompany;
  pappers?: (siren: string) => Promise<HoldingProfile | null>;
};

/** Profil lu dans l'annuaire, ou `null` s'il n'y figure pas. */
export async function holdingFromDirectory(siren: string, resolve: typeof resolveCompany = resolveCompany): Promise<HoldingProfile | null> {
  const found = await resolve(siren).catch(() => null);
  if (!found?.ok || found.data.siren !== siren) return null;
  const base = found.data;
  return {
    siren,
    name: base.company_name,
    people: base.leader_person
      ? [{ name: base.leader_person, role: null, isCompany: false, siren: null, firstName: null, lastName: null, since: null }]
      : [],
    revenue_eur: base.figures.revenue_eur ?? null,
    headcount: effectifFloor(base.figures.effectif_code) ?? null,
  };
}

export async function readHolding(siren: string, deps: Deps = {}): Promise<HoldingRead | null> {
  const clean = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(clean)) return null;
  const directory = await cached<HoldingProfile>(`annuaire:holding:${clean}`, () => holdingFromDirectory(clean, deps.resolve)).catch(() =>
    holdingFromDirectory(clean, deps.resolve),
  );
  const hasFigures = Boolean(directory && (directory.revenue_eur != null || directory.headcount != null));
  if (directory && hasFigures) return { profile: directory, pappersCalls: 0, source: "annuaire" };

  // Aucun chiffre dans l'annuaire : la règle d'exclusion a besoin des finances de la holding.
  const pappers = await (deps.pappers ?? fetchHoldingProfile)(clean).catch(() => null);
  if (pappers) {
    return {
      profile: { ...pappers, people: pappers.people.length ? pappers.people : directory?.people ?? [] },
      pappersCalls: 1,
      source: "pappers",
    };
  }
  return directory ? { profile: directory, pappersCalls: 0, source: "annuaire" } : null;
}
