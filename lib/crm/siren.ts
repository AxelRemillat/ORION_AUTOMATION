/**
 * SIREN d'un commerce via l'API « Recherche d'entreprises » de l'État (recherche-entreprises.api.gouv.fr) :
 * GRATUITE, sans clé ni crédit, ouverte même pendant la pause de la prospection. Jamais Pappers ici.
 *
 * Renvoie au plus 5 candidats (nom, SIREN, commune, activité) : c'est Axel qui choisit, rien n'est rempli d'office.
 */
export interface CandidatSiren {
  siren: string;
  nom: string;
  commune: string | null;
  codePostal: string | null;
  activite: string | null;
  enActivite: boolean;
}

const URL_API = "https://recherche-entreprises.api.gouv.fr/search";

interface ReponseApi {
  results?: {
    siren?: string;
    nom_complet?: string;
    etat_administratif?: string;
    activite_principale?: string;
    siege?: { libelle_commune?: string; code_postal?: string };
  }[];
}

/** Code pur : transforme la réponse de l'API en candidats (testé sans réseau). */
export function lireCandidats(reponse: ReponseApi): CandidatSiren[] {
  return (reponse.results ?? [])
    .filter((r) => r.siren && /^\d{9}$/.test(r.siren))
    .slice(0, 5)
    .map((r) => ({
      siren: r.siren as string,
      nom: r.nom_complet ?? "",
      commune: r.siege?.libelle_commune ?? null,
      codePostal: r.siege?.code_postal ?? null,
      activite: r.activite_principale ?? null,
      enActivite: r.etat_administratif !== "C",
    }));
}

export async function chercherSiren(
  nom: string,
  ville?: string | null,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ ok: true; candidats: CandidatSiren[] } | { ok: false; error: string }> {
  const q = [nom, ville].filter(Boolean).join(" ").trim();
  if (q.length < 3) return { ok: false, error: "Nom trop court pour chercher un SIREN." };
  const params = new URLSearchParams({ q, per_page: "5", page: "1" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_000);
  try {
    const res = await (options.fetch ?? fetch)(`${URL_API}?${params}`, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { ok: false, error: `Annuaire indisponible (HTTP ${res.status}).` };
    return { ok: true, candidats: lireCandidats((await res.json()) as ReponseApi) };
  } catch {
    return { ok: false, error: "Annuaire injoignable." };
  } finally {
    clearTimeout(timer);
  }
}
