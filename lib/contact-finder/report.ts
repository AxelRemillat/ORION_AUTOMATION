import type { ContactResult, ContactTrace } from "./types";

/**
 * COMPTE RENDU d'une recherche de contact, en français simple.
 *
 * « Aucun site prouvé pour cette entreprise » ne disait pas ce qui avait été
 * cherché : on ne savait pas s'il fallait insister, saisir le site à la main ou
 * conclure qu'il n'y en avait pas. Ce module relit le journal enregistré sur la
 * fiche (`contact_search`) et en tire 5 à 10 lignes et une conclusion.
 *
 * Aucun modèle : tout vient du chemin suivi et des dépenses déjà journalisées.
 * Module pur (importable côté client). Il lit aussi les journaux antérieurs à
 * ses champs structurés, en se rabattant sur `steps`.
 */

/** Ce que `contact_search` contient en base. */
export type StoredSearch = Partial<ContactTrace> & {
  result?: ContactResult;
  checked_at?: string;
  /** Coût calculé à l'enregistrement (grille de lib/usage/pricing). */
  cost_eur?: number | null;
  /** `true` quand des appels Hunter ont eu lieu sans prix configuré. */
  cost_excludes_hunter?: boolean;
  /** Ce qui a été cherché sur chaque page : « SIREN », « raison sociale »… */
  looked_for?: string[];
  /** Conclusions des recherches précédentes, la plus récente d'abord. */
  history?: PastSearch[];
};

export interface PastSearch {
  checked_at: string;
  conclusion: string;
  failed: boolean;
}

export interface SearchReport {
  checkedAt: string | null;
  /** `true` quand aucune adresse n'a été trouvée : le bloc s'ouvre alors seul. */
  failed: boolean;
  conclusion: string;
  lines: string[];
}

export const MAX_REPORT_LINES = 10;
const DEFAULT_LOOKED_FOR = ["SIREN", "raison sociale", "ville", "adresses e-mail"];

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

const pathOf = (url: string): string => {
  try {
    const path = decodeURIComponent(new URL(url).pathname).replace(/\/$/, "");
    return path || "/";
  } catch {
    return url;
  }
};

const hostOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** Requêtes lancées : champ structuré, ou relues dans `steps` (journaux anciens). */
function queriesOf(search: StoredSearch): { query: string; results: number }[] {
  if (search.queries) return search.queries;
  return (search.steps ?? []).flatMap((step) => {
    const match = /^recherche « (.+) » : (\d+) résultat/.exec(step);
    return match ? [{ query: match[1], results: Number(match[2]) }] : [];
  });
}

function hunterOf(search: StoredSearch): string[] {
  if (search.hunter) return search.hunter.map((item) => `${item.call} ${item.target} → ${item.result}`);
  return (search.steps ?? []).filter((step) => step.startsWith("Hunter ")).map((step) => step.slice(7).replace(" : ", " → "));
}

function costLine(search: StoredSearch): string {
  const spent = search.spent;
  if (!spent) return "Coût : non enregistré pour cette recherche.";
  const hunter = spent.hunterDomainSearch + spent.hunterFinder + spent.hunterVerifier;
  const parts = [
    plural(spent.linkup, "recherche") + " Linkup",
    plural(hunter, "appel") + " Hunter",
    ...(spent.llm ? [plural(spent.llm, "appel") + " modèle"] : []),
    `${plural(spent.pages, "page")} lue${spent.pages > 1 ? "s" : ""} (gratuit)`,
  ];
  const euros =
    typeof search.cost_eur === "number"
      ? ` — ${search.cost_eur.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 3 })}` +
        (search.cost_excludes_hunter ? " hors Hunter (prix non configuré)" : "")
      : "";
  return `Coût : ${parts.join(", ")}${euros}.`;
}

export function conclusionOf(search: StoredSearch): { failed: boolean; conclusion: string } {
  const result = search.result;
  const site = hostOf(result?.website);
  const hunterCalls = hunterOf(search).length;
  if (result?.email) {
    const kind = result.email_type === "nominatif" ? "nominative" : "générique";
    return { failed: false, conclusion: `Adresse ${kind} trouvée : ${result.email} (confiance ${result.confidence} %).` };
  }
  if (site) {
    return {
      failed: true,
      conclusion: hunterCalls
        ? `Site trouvé (${site}) mais aucune adresse publiée, et Hunter n'en connaît aucune.`
        : `Site trouvé (${site}) mais aucune adresse publiée.`,
    };
  }
  const candidates = search.candidates ?? [];
  const near = candidates.filter((item) => !item.validated && item.confidence >= 45).sort((a, b) => b.confidence - a.confidence)[0];
  if (near) {
    return {
      failed: true,
      conclusion: `Un site porte leur nom (${near.domain}) sans preuve suffisante (${near.reason}) : à vérifier, puis à saisir s'il est bon.`,
    };
  }
  if (candidates.some((item) => item.reason === "budget de pages épuisé")) {
    return { failed: true, conclusion: "Recherche arrêtée par le budget de lecture avant d'avoir prouvé un site : saisissez-le s'il existe." };
  }
  const queries = queriesOf(search);
  if (queries.some((item) => /^"\d{9}"/.test(item.query))) {
    return { failed: true, conclusion: "Aucun site ne mentionne ce SIREN : l'entreprise n'a probablement pas de site." };
  }
  if (!queries.length) {
    return { failed: true, conclusion: "Aucune recherche web n'a pu être lancée : aucun site trouvé (clé Linkup absente ?)." };
  }
  return { failed: true, conclusion: "Aucun site officiel trouvé pour cette entreprise." };
}

export function searchReport(search: StoredSearch | null | undefined): SearchReport | null {
  if (!search || (!search.steps && !search.candidates && !search.result)) return null;
  const { failed, conclusion } = conclusionOf(search);
  const lookedFor = (search.looked_for?.length ? search.looked_for : DEFAULT_LOOKED_FOR).join(", ");

  const head: string[] = queriesOf(search)
    .slice(0, 3)
    .map((item) => `Recherche web « ${item.query} » : ${plural(item.results, "résultat")}.`);
  if (!head.length) head.push("Aucune recherche web lancée.");

  const skipped = search.skipped ?? [];
  if (skipped.length) {
    const named = skipped.slice(0, 4).map((item) => `${item.domain} (${item.reason})`).join(", ");
    head.push(`Écartés sans lecture : ${named}${skipped.length > 4 ? ` et ${skipped.length - 4} autre(s)` : ""}.`);
  }

  const read = (search.candidates ?? []).map((item) => {
    const pages = item.pages?.length
      ? ` — pages : ${item.pages.map((page) => `${pathOf(page.url)}${page.ok ? "" : " (injoignable)"}`).join(", ")}`
      : "";
    const verdict = item.validated ? `retenu, ${item.reason}` : item.reason;
    return `Lu : ${item.domain}${pages}. Cherché : ${lookedFor}. Résultat : ${verdict}.`;
  });

  const hunter = hunterOf(search);
  const tail = [
    hunter.length ? `Hunter : ${hunter.join(" ; ")}.` : "Hunter non interrogé : aucun domaine d'adresse prouvé.",
    costLine(search),
  ];

  // 10 lignes au plus : on coupe dans les domaines lus, jamais dans le reste.
  const room = Math.max(1, MAX_REPORT_LINES - head.length - tail.length);
  const shown = read.length > room ? [...read.slice(0, room - 1), `… et ${read.length - room + 1} autre(s) domaine(s) lu(s).`] : read;
  return { checkedAt: search.checked_at ?? null, failed, conclusion, lines: [...head, ...shown, ...tail] };
}
