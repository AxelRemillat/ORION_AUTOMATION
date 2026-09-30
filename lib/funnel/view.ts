import type { SignalCandidateRow } from "@/types";
import type { Identity, SignalFacts, Triage } from "./types";

/**
 * Ce que l'écran /recherche affiche d'une ligne `signal_candidates`. Code pur,
 * partagé par la route et les tests : les règles d'affichage du brief (CA,
 * nouvelle direction, badges) vivent ici, pas dans les composants.
 */

export type ContactBadge = "nominatif" | "generique" | "aucun";

export interface FunnelCard {
  id: string;
  companyName: string;
  siren: string | null;
  city: string | null;
  source: string;
  sourceLabel: string;
  date: string | null;
  url: string | null;
  label: string;
  /** « Nouvelle direction » : le NOUVEAU dirigeant lu dans BODACC. */
  newLeader: string | null;
  jobTitle: string | null;
  pain: string | null;
  hook: string | null;
  score: number | null;
  badges: string[];
  /** « CA 2024 : 3,2 M€ », « CA non publié », ou null (trop ancien : masqué). */
  revenue: string | null;
  contact: ContactBadge | null;
  email: string | null;
  /** Adresse gardée hors du domaine du site, sur la seule foi de Hunter « valid ». */
  emailDoubtful: boolean;
  /** Téléphone du site : sans email, la carte part dans « À appeler ». */
  phone: string | null;
  prospectId: string | null;
  publication: "pret" | "a_completer" | null;
  statut: SignalCandidateRow["statut"];
}

export interface FunnelReject {
  id: string;
  companyName: string;
  source: string;
  date: string | null;
  reason: string;
}

const SOURCES: Record<string, string> = { bodacc: "BODACC", "france-travail": "France Travail", linkup: "Presse" };

/** Au-delà de 3 exercices, un CA ne dit plus rien de l'entreprise : on le masque. */
export const REVENUE_MAX_AGE_YEARS = 3;

const money = (value: number) =>
  value >= 1_000_000
    ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value / 1_000_000)} M€`
    : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(value / 1_000))} k€`;

/** Règle du brief : 0 ou absent → « non publié » ; année affichée ; > 3 ans → masqué. */
export function revenueLabel(revenue: number | null | undefined, year: number | null | undefined, now = new Date()): string | null {
  if (!revenue || revenue <= 0) return "CA non publié";
  if (year && now.getFullYear() - year > REVENUE_MAX_AGE_YEARS) return null;
  return year ? `CA ${year} : ${money(revenue)}` : `CA : ${money(revenue)}`;
}

/** « Claire MARTIN, présidente » — le nouveau dirigeant, jamais le sortant. */
export function newLeaderLabel(facts: SignalFacts): string | null {
  const leader = facts.newLeaders?.[0];
  if (!leader) return null;
  const name = [leader.firstName, leader.surname].filter(Boolean).join(" ");
  return name ? `${name}${leader.role ? `, ${leader.role}` : ""}` : null;
}

export function toCard(row: SignalCandidateRow, now = new Date()): FunnelCard {
  const facts = (row.facts ?? {}) as unknown as SignalFacts;
  const identity = row.identity as unknown as Partial<Identity> | null;
  const triage = row.triage as unknown as Triage | null;
  const contact = row.contact as { email?: string; badge?: ContactBadge; doubtful?: boolean; phone?: string } | null;
  return {
    id: row.id,
    companyName: identity?.name || row.company_name || "Entreprise",
    siren: identity?.siren || row.siren,
    city: identity?.city ?? facts.city ?? null,
    source: row.source,
    sourceLabel: SOURCES[row.source] ?? row.source,
    date: row.date_signal,
    url: row.url_source,
    label: facts.label ?? "Signal",
    newLeader: newLeaderLabel(facts),
    jobTitle: facts.jobTitle ?? null,
    pain: triage?.pain_probable || null,
    hook: triage?.accroche_possible || null,
    score: row.score,
    badges: row.badges ?? [],
    revenue: identity ? revenueLabel(identity.revenue, identity.revenueYear, now) : null,
    contact: contact?.badge ?? null,
    email: contact?.email ?? null,
    emailDoubtful: contact?.doubtful === true,
    phone: contact?.phone ?? null,
    prospectId: row.prospect_id,
    publication: row.publication,
    statut: row.statut,
  };
}

/** Cartes : retenus et creusés, du meilleur score au moins bon, puis du plus récent. */
export function cardsOf(rows: readonly SignalCandidateRow[], now = new Date()): FunnelCard[] {
  return rows
    .filter((row) => row.statut === "retenu" || row.statut === "creusé")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.date_signal).localeCompare(String(a.date_signal)))
    .map((row) => toCard(row, now));
}

export function rejectsOf(rows: readonly SignalCandidateRow[], limit = 200): FunnelReject[] {
  return rows
    .filter((row) => row.statut === "rejeté")
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      companyName: (row.identity as { name?: string } | null)?.name || row.company_name || "Entreprise",
      source: SOURCES[row.source] ?? row.source,
      date: row.date_signal,
      reason: row.motif_rejet ?? "sans motif",
    }));
}
