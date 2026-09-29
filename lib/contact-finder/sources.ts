import { singleCompanyName } from "@/lib/company-name";
import { cached } from "@/lib/enrichment/cache";
import { fetchPappers, hasPappersKey } from "@/lib/enrichment/pappers";
import { limitedFetch, ANNUAIRE_RATE_PER_SECOND } from "@/lib/enrichment/rate-limit";
import type { Prospect } from "@/types";
import { nafLabel } from "@/lib/naf";
import { usageName } from "./names";
import type { CompanyIdentity } from "./types";

/**
 * Ce qu'on sait de l'entreprise, rassemblé AVANT de chercher.
 *
 * Trois sources, de la moins chère à la plus chère :
 *   1. la fiche elle-même (site, adresse, ville, dirigeant) ;
 *   2. l'annuaire public (gratuit) : noms commerciaux et ENSEIGNES — c'est
 *      « Boulangerie Bonnin Frères » qui mène au site, pas « SARL BONNIN FRERES » ;
 *   3. Pappers (mis en cache 30 jours) : site déclaré et représentants.
 */

interface AnnuaireCompany {
  nom_complet?: string;
  nom_raison_sociale?: string;
  activite_principale?: string | null;
  siege?: {
    nom_commercial?: string | null;
    liste_enseignes?: string[] | null;
    libelle_commune?: string;
    code_postal?: string;
    activite_principale?: string | null;
  };
  matching_etablissements?: { liste_enseignes?: string[] | null; nom_commercial?: string | null }[];
  dirigeants?: { type_dirigeant?: string; nom?: string; prenoms?: string }[];
}

async function annuaire(siren: string): Promise<AnnuaireCompany | null> {
  return cached<AnnuaireCompany>(`contact:annuaire:${siren}`, async () => {
    const outcome = await limitedFetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`,
      { key: "annuaire", ratePerSecond: ANNUAIRE_RATE_PER_SECOND, attempts: 2, init: { headers: { Accept: "application/json" } } },
    );
    if (!outcome.response?.ok) return null;
    const body = (await outcome.response.json()) as { results?: AnnuaireCompany[] };
    return body.results?.[0] ?? null;
  }).catch(() => null);
}

const clean = (values: (string | null | undefined)[]) =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value && value.length >= 3)))];

/**
 * Libellé de métier utilisable dans une requête web.
 *
 * Seule la sous-classe est retenue. « Industries alimentaires » ou « Commerce de
 * gros » désignent des milliers d'entreprises : ajouté à une requête, un libellé
 * de division noie le nom au lieu de le préciser.
 */
function preciseActivity(code: string | null | undefined): string | null {
  const label = nafLabel(code);
  return label?.precision === "sous-classe" ? label.label : null;
}

export async function identityOf(rawProspect: Prospect, website?: string | null): Promise<CompanyIdentity> {
  // « GLOBAL 2F (GLOBAL 2F) » partait tel quel dans les requêtes et la validation.
  const prospect = { ...rawProspect, company_name: singleCompanyName(rawProspect.company_name) };
  const figures = (prospect.key_figures ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof figures[key] === "string" ? (figures[key] as string) : null);
  const siren = prospect.siren?.replace(/\s/g, "") || null;

  const [registry, pappers] = await Promise.all([
    siren ? annuaire(siren) : Promise.resolve(null),
    siren && hasPappersKey() ? fetchPappers(siren).then((r) => (r.ok ? r.data : null)).catch(() => null) : Promise.resolve(null),
  ]);

  const tradeNames = clean([
    registry?.siege?.nom_commercial,
    ...(registry?.siege?.liste_enseignes ?? []),
    ...(registry?.matching_etablissements ?? []).flatMap((item) => [item.nom_commercial, ...(item.liste_enseignes ?? [])]),
    ...(pappers?.openings ?? []).map((opening) => opening.sign),
  ]).filter((name) => name.toLowerCase() !== prospect.company_name.toLowerCase());

  // Dirigeant : Pappers (prénom séparé) > annuaire > fiche. Nom d'USAGE.
  //
  // LE DIRIGEANT ÉPONYME PASSE DEVANT. BRIOL DIFFUSION a deux gérants au
  // registre : Séverine Nassif (2022) et Xavier Briol (2017). Pappers rend
  // Nassif en premier, et c'est elle qu'on cherchait chez Hunter — alors que
  // l'entreprise, le domaine et l'adresse de contact portent tous le nom BRIOL.
  // Quand le nom de famille d'un représentant figure dans la dénomination, c'est
  // lui l'interlocuteur : les PME familiales sont la majorité de cette base.
  const people = (pappers?.representatives ?? []).filter((item) => !item.isCompany);
  const denomination = (registry?.nom_raison_sociale || prospect.company_name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const denominationWords = denomination.split(/[^a-z0-9]+/).filter(Boolean);
  const eponymous = people.find((item) => {
    const last = (item.lastName ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return last.length >= 4 && denominationWords.includes(last);
  });
  const rep = eponymous ?? people[0];
  const boss = registry?.dirigeants?.find((item) => item.type_dirigeant === "personne physique" && item.nom);
  const leader =
    (rep ? usageName(rep.name, { firstName: rep.firstName }) : null) ??
    (boss ? usageName(`${boss.prenoms ?? ""} ${boss.nom}`.trim(), { firstName: boss.prenoms?.split(" ")[0] }) : null) ??
    usageName(text("leader_person"));

  return {
    prospectId: prospect.id,
    legalName: registry?.nom_raison_sociale || prospect.company_name,
    tradeNames,
    siren,
    city: prospect.city ?? registry?.siege?.libelle_commune ?? null,
    postalCode: text("postal_code") ?? registry?.siege?.code_postal ?? null,
    leader,
    activity: preciseActivity(
      registry?.activite_principale ?? registry?.siege?.activite_principale ?? text("naf_code"),
    ),
    knownWebsite: website ?? prospect.website,
    pappersWebsite: pappers?.website ?? null,
    knownEmail: prospect.email,
  };
}
