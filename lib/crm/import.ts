/**
 * IMPORT INITIAL DU CRM (Cowork #117) — code pur, testé dans scripts/crm.test.ts. Le script `npm run crm:import`
 * (scripts/crm-import.ts) lit la base et applique ce plan ; il SIMULE par défaut, n'écrit qu'avec `--apply`.
 *
 * 1. Optique des Alpes : premier client signé du Web des Artisans (Guillaume Teissedre, La Mure), étape « en ligne ».
 * 2. Les prospects de la prospection e-mail qui ont montré un intérêt (statut « répondu », « en discussion » ou
 *    « gagné », hors corbeille) : une fiche « contacté » reliée au prospect (`prospect_id`), canal « prospection
 *    e-mail ». Rien n'est modifié ni supprimé côté prospects.
 * Idempotent : une fiche déjà reliée au prospect, ou portant déjà le même nom dans la même ville, n'est pas recréée.
 */
import type { Commerce } from "./types";
import { normaliser } from "./logique";

export const STATUTS_INTERESSES = ["repondu", "en_discussion", "gagne"] as const;

export interface ProspectSource {
  id: string;
  company_name: string;
  city: string | null;
  sector: string | null;
  siren: string | null;
  website: string | null;
  status: string;
  contact_name?: string | null;
  contact_role?: string | null;
  deleted_at?: string | null;
}

export type FicheAImporter = Partial<Commerce> & { nom: string; origine: string };

export const OPTIQUE_DES_ALPES: FicheAImporter = {
  origine: "client signé (Cowork #117)",
  nom: "Optique des Alpes",
  metier: "Opticien",
  ville: "La Mure",
  adresse: "2 place Pasteur, 38350 La Mure",
  telephone: "04 76 81 27 73",
  contact_prenom: "Guillaume Teissedre",
  contact_role: "Gérant",
  canal: "terrain",
  etape: "en_ligne",
  site_existant: true,
  notes: "Premier client du Web des Artisans : site livré et en ligne.",
};

const cle = (nom: string, ville: string | null | undefined) => `${normaliser(nom)}|${normaliser(ville)}`;

const prenomDe = (nom: string | null | undefined) => (nom ? nom.trim().split(/\s+/)[0] : null);

/** Le plan : les fiches à créer, et celles écartées (déjà présentes) avec la raison. */
export function planImport(existants: Pick<Commerce, "nom" | "ville" | "prospect_id">[], prospects: ProspectSource[]): { creer: FicheAImporter[]; ignorees: { nom: string; raison: string }[] } {
  const cles = new Set(existants.map((c) => cle(c.nom, c.ville)));
  const relies = new Set(existants.map((c) => c.prospect_id).filter(Boolean));
  const creer: FicheAImporter[] = [];
  const ignorees: { nom: string; raison: string }[] = [];
  const ajouter = (f: FicheAImporter) => {
    if (f.prospect_id && relies.has(f.prospect_id)) return ignorees.push({ nom: f.nom, raison: "déjà relié à une fiche" });
    if (cles.has(cle(f.nom, f.ville))) return ignorees.push({ nom: f.nom, raison: "fiche du même nom dans la même ville" });
    cles.add(cle(f.nom, f.ville));
    if (f.prospect_id) relies.add(f.prospect_id);
    creer.push(f);
  };
  ajouter(OPTIQUE_DES_ALPES);
  for (const p of prospects) {
    if (p.deleted_at || !(STATUTS_INTERESSES as readonly string[]).includes(p.status)) continue;
    ajouter({
      origine: `prospect ${p.status}`,
      nom: p.company_name,
      metier: p.sector,
      ville: p.city,
      siren: p.siren && /^\d{9}$/.test(p.siren) ? p.siren : null,
      site_existant: p.website ? true : null,
      site_url: p.website,
      contact_prenom: prenomDe(p.contact_name),
      contact_role: p.contact_role ?? null,
      canal: "prospection_email",
      etape: p.status === "gagne" ? "signe" : "contacte",
      prospect_id: p.id,
      notes: "Importé de la prospection e-mail (a montré un intérêt pour un site).",
    });
  }
  return { creer, ignorees };
}

/** Lignes prêtes pour `crm_commerces` (sans le champ `origine`, propre au rapport). */
export function lignesCommerces(fiches: FicheAImporter[], userId: string, maintenant = new Date()): Record<string, unknown>[] {
  return fiches.map((f) => {
    const { origine: _origine, ...reste } = f;
    void _origine;
    return { ...reste, user_id: userId, etape_le: maintenant.toISOString() };
  });
}
