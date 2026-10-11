import type { Opportunity, Platform } from "./types";
import type { OpportunityEmail } from "./email/view";
import { bucketOf, isOutdated, rowLane, type Bucket } from "./view";
import { followUpDue } from "./follow-up-due";

/**
 * ONGLETS PAR PLATEFORME de /opportunites (Cowork #19) — code pur.
 *
 * Codeur · Upwork · ComeUp, Codeur par défaut (`?p=codeur|upwork|comeup`). Pas
 * d'onglet Malt (pas d'API d'offres) : les fiches Malt et « Autre » vont dans un
 * onglet « Autres », affiché seulement s'il en a au moins une — rien ne disparaît.
 */
export const PLATFORM_TABS = ["codeur", "upwork", "comeup"] as const;
export type PlatformTab = (typeof PLATFORM_TABS)[number] | "autres";

export const TAB_LABELS: Record<PlatformTab, string> = { codeur: "Codeur", upwork: "Upwork", comeup: "ComeUp", autres: "Autres" };

export function tabOf(platform: Platform): PlatformTab {
  return platform === "codeur" || platform === "upwork" || platform === "comeup" ? platform : "autres";
}

type Row = Pick<Opportunity, "id" | "platform" | "fit_score" | "status" | "seen_at">;

/** Onglets affichés : les trois plateformes, puis « Autres » s'il n'est pas vide. */
export function visibleTabs(items: readonly Pick<Opportunity, "platform">[]): PlatformTab[] {
  return items.some((item) => tabOf(item.platform) === "autres") ? [...PLATFORM_TABS, "autres"] : [...PLATFORM_TABS];
}

/**
 * Même règle que le badge de la barre (app/(app)/layout.tsx) : non vue, pas « Ignorée »,
 * score ≥ 8 — ou mission de lancement Codeur (11/10/2026), sans motif de filtre.
 */
export const isBadgeAlert = (row: Pick<Opportunity, "fit_score" | "status" | "seen_at"> & Partial<Opportunity>, now = new Date()): boolean =>
  !row.seen_at && row.status !== "ignoree" && !isOutdated(row as Parameters<typeof isOutdated>[0], now) && ((row.fit_score != null && row.fit_score >= 8) || (!row.filter_reason && rowLane(row as Parameters<typeof rowLane>[0]) === "lancement"));

/** Alertes non vues par onglet. */
export function tabBadges(items: readonly Row[]): Record<PlatformTab, number> {
  const badges: Record<PlatformTab, number> = { codeur: 0, upwork: 0, comeup: 0, autres: 0 };
  for (const item of items) if (isBadgeAlert(item)) badges[tabOf(item.platform)] += 1;
  return badges;
}

export const itemsOfTab = <T extends Pick<Opportunity, "platform">>(items: readonly T[], tab: PlatformTab): T[] => items.filter((item) => tabOf(item.platform) === tab);

/**
 * E-mails « à trier » d'un onglet : Upwork et ComeUp les leurs ; Codeur garde
 * tous les autres (Codeur, Malt, Autre, plateforme inconnue), comme avant.
 */
export function emailsOfTab<T extends Pick<OpportunityEmail, "platform">>(emails: readonly T[], tab: PlatformTab): T[] {
  if (tab === "upwork" || tab === "comeup") return emails.filter((email) => email.platform === tab);
  if (tab === "codeur") return emails.filter((email) => email.platform !== "upwork" && email.platform !== "comeup");
  return [];
}

const isTab = (value: unknown): value is PlatformTab => value === "codeur" || value === "upwork" || value === "comeup" || value === "autres";

/**
 * Onglet d'arrivée : la fiche visée par `?id=` (notification ntfy) impose le sien ;
 * puis `?p=` s'il est affiché ; un lien `?filtre=relances|a_trier` sans `?p=` ouvre
 * le premier onglet qui a de quoi montrer ; sinon Codeur.
 */
export function initialTab(input: {
  p?: string | null;
  id?: string | null;
  filter?: "relances" | "a_trier" | null;
  items: readonly (Row & Pick<Opportunity, "sent_at" | "replied_at"> & Partial<Pick<Opportunity, "followed_up_at">>)[];
  toSort?: readonly Pick<OpportunityEmail, "platform">[];
}): PlatformTab {
  const focused = input.id ? input.items.find((item) => item.id === input.id) : undefined;
  if (focused) return tabOf(focused.platform);
  const tabs = visibleTabs(input.items);
  if (isTab(input.p) && tabs.includes(input.p)) return input.p;
  if (input.filter === "relances") return tabs.find((tab) => itemsOfTab(input.items, tab).some((item) => followUpDue(item))) ?? "codeur";
  if (input.filter === "a_trier") return tabs.find((tab) => emailsOfTab(input.toSort ?? [], tab).length > 0) ?? "codeur";
  return "codeur";
}

/** Plateforme pré-réglée du formulaire « Coller une annonce » (modifiable). */
export function formPlatform(tab: PlatformTab): Platform {
  return tab === "autres" ? "malt" : tab;
}

export type Filter = Bucket | "toutes" | "a_trier" | "relances";

/** Filtres par score d'un onglet : « Ignorées » disparaît hors Codeur quand il est vide. */
export function bucketFilters(tab: PlatformTab, items: readonly Parameters<typeof bucketOf>[0][]): (Bucket | "toutes")[] {
  const ignored = items.some((item) => bucketOf(item) === "ignorees");
  return tab === "codeur" || ignored ? ["alertes", "a_voir", "ignorees", "toutes"] : ["alertes", "a_voir", "toutes"];
}

export const tabHref = (tab: PlatformTab) => `/opportunites?p=${tab}`;
