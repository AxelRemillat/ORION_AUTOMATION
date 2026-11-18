/**
 * CRM — logique pure (sans réseau ni base), testée par scripts/crm.test.ts.
 *
 *  - `nettoyerSaisie`     : la fiche saisie en 30 s sur le téléphone (champs vides → null, URL, téléphone, SIREN) ;
 *  - `changementEtape`    : passage d'une étape à l'autre, avec l'événement de chronologie qui l'accompagne ;
 *  - `tachesDuJour`       : les prochaines actions dues aujourd'hui ou en retard, pour « Aujourd'hui » ;
 *  - `filtrerCommerces`   : recherche instantanée (sans accents ni casse) et filtres étape / métier / ville ;
 *  - `parEtape`           : regroupement pour le kanban.
 */
import { estCanal, estEtape, type Canal, type Commerce, type Etape } from "./types";

export type Saisie = Partial<Record<keyof Commerce, unknown>>;

const texte = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** « 04 76 81 27 73 », « +33 4… » : on garde les chiffres et le + initial, sans rien inventer. */
export function nettoyerTelephone(v: unknown): string | null {
  const t = texte(v);
  if (!t) return null;
  const garde = t.replace(/[^\d+]/g, "");
  return garde.length >= 6 ? t.replace(/\s+/g, " ") : null;
}

/** SIREN = 9 chiffres (les espaces sont tolérés). Autre chose : null, plutôt qu'un identifiant faux. */
export function nettoyerSiren(v: unknown): string | null {
  const t = texte(v)?.replace(/\s/g, "") ?? null;
  return t && /^\d{9}$/.test(t) ? t : null;
}

/** Ajoute https:// à une adresse saisie sans protocole ; refuse ce qui n'a pas la forme d'une URL. */
export function nettoyerUrl(v: unknown): string | null {
  const t = texte(v);
  if (!t) return null;
  const avec = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(avec);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Instagram : « @boulangerie », « boulangerie » ou l'URL complète → « @boulangerie ». */
export function nettoyerInstagram(v: unknown): string | null {
  const t = texte(v);
  if (!t) return null;
  const m = t.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const pseudo = (m ? m[1] : t.replace(/^@/, "")).trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(pseudo) ? `@${pseudo}` : null;
}

const montant = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

const date = (v: unknown): string | null => {
  const t = texte(v);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

export interface Erreurs {
  [champ: string]: string;
}

/**
 * Nettoie une saisie de fiche (création ou modification). Seuls les champs PRÉSENTS dans la saisie sont renvoyés :
 * une modification partielle n'écrase pas le reste. `nom` est obligatoire à la création.
 */
export function nettoyerSaisie(saisie: Saisie, creation: boolean): { valeurs: Partial<Commerce>; erreurs: Erreurs } {
  const v: Partial<Commerce> = {};
  const erreurs: Erreurs = {};
  const a = (k: keyof Commerce) => Object.prototype.hasOwnProperty.call(saisie, k);

  if (a("nom") || creation) {
    const nom = texte(saisie.nom);
    if (!nom) erreurs.nom = "Le nom du commerce est obligatoire.";
    else v.nom = nom;
  }
  for (const k of ["metier", "ville", "adresse", "contact_prenom", "contact_role", "notes", "motif_perte", "prochaine_action"] as const) {
    if (a(k)) v[k] = texte(saisie[k]);
  }
  if (a("telephone")) v.telephone = nettoyerTelephone(saisie.telephone);
  if (a("instagram")) v.instagram = nettoyerInstagram(saisie.instagram);
  for (const k of ["fiche_google", "site_url", "maquette_url"] as const) {
    if (a(k)) {
      const brut = texte(saisie[k]);
      const url = nettoyerUrl(brut);
      if (brut && !url) erreurs[k] = "Adresse web invalide.";
      v[k] = url;
    }
  }
  if (a("site_existant")) v.site_existant = saisie.site_existant === null || saisie.site_existant === "" ? null : saisie.site_existant === true || saisie.site_existant === "oui";
  if (a("siren")) {
    const brut = texte(saisie.siren);
    const siren = nettoyerSiren(brut);
    if (brut && !siren) erreurs.siren = "Un SIREN compte 9 chiffres.";
    v.siren = siren;
  }
  if (a("canal")) {
    if (estCanal(saisie.canal)) v.canal = saisie.canal as Canal;
    else erreurs.canal = "Canal inconnu.";
  }
  if (a("etape")) {
    if (estEtape(saisie.etape)) v.etape = saisie.etape as Etape;
    else erreurs.etape = "Étape inconnue.";
  }
  if (a("prochaine_action_le")) v.prochaine_action_le = date(saisie.prochaine_action_le);
  if (a("offre_id")) v.offre_id = texte(saisie.offre_id);
  if (a("montant_devis")) {
    const m = montant(saisie.montant_devis);
    if (saisie.montant_devis !== "" && saisie.montant_devis != null && m === null) erreurs.montant_devis = "Montant invalide.";
    v.montant_devis = m;
  }
  if (a("date_signature")) v.date_signature = date(saisie.date_signature);
  if (a("accord_demo")) v.accord_demo = saisie.accord_demo === true || saisie.accord_demo === "oui" || saisie.accord_demo === "on";
  if (a("accord_demo_le")) v.accord_demo_le = date(saisie.accord_demo_le);
  // Un accord de démonstration signé sans date prend celle du jour ; retiré, il perd sa date.
  if (v.accord_demo === true && !v.accord_demo_le) v.accord_demo_le = aujourdhuiParis();
  if (v.accord_demo === false) v.accord_demo_le = null;
  return { valeurs: v, erreurs };
}

/**
 * Passage d'étape. Renvoie les champs à écrire et l'événement de chronologie (type « etape »).
 * « Perdu » exige un motif. Rien à faire si l'étape ne change pas.
 */
export function changementEtape(
  avant: Pick<Commerce, "etape" | "date_signature">,
  apres: Etape,
  options: { motif?: string | null; maintenant?: Date } = {},
): { erreur: string } | { identique: true } | { champs: Partial<Commerce>; evenement: { type: "etape"; contenu: string; meta: Record<string, unknown> } } {
  if (!estEtape(apres)) return { erreur: "Étape inconnue." };
  if (avant.etape === apres) return { identique: true };
  const motif = texte(options.motif ?? null);
  if (apres === "perdu" && !motif) return { erreur: "Indiquez le motif de la perte." };
  const maintenant = options.maintenant ?? new Date();
  const champs: Partial<Commerce> = { etape: apres, etape_le: maintenant.toISOString(), motif_perte: apres === "perdu" ? motif : null };
  // La signature date le contrat, sauf si une date a déjà été saisie.
  if (apres === "signe" && !avant.date_signature) champs.date_signature = maintenant.toISOString().slice(0, 10);
  const de = avant.etape;
  return {
    champs,
    evenement: {
      type: "etape",
      contenu: apres === "perdu" ? `Perdu : ${motif}` : `${libelle(de)} → ${libelle(apres)}`,
      meta: { de, vers: apres, ...(motif && apres === "perdu" ? { motif } : {}) },
    },
  };
}

const libelle = (e: string) =>
  ({ a_contacter: "À contacter", contacte: "Contacté", maquette_envoyee: "Maquette envoyée", rdv: "RDV", devis_envoye: "Devis envoyé", signe: "Signé", en_ligne: "En ligne", perdu: "Perdu" })[e] ?? e;

/** Date du jour à Paris, AAAA-MM-JJ (les échéances sont des dates civiles, pas des instants). */
export function aujourdhuiParis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(maintenant);
}

export interface Tache {
  commerce: Commerce;
  /** Jours de retard (0 = aujourd'hui). */
  retard: number;
}

/**
 * Les relances du jour : fiches actives (ni archivées, ni perdues, ni en ligne sans action) dont la prochaine action
 * est datée d'aujourd'hui ou avant. Les plus en retard d'abord, puis par nom.
 */
export function tachesDuJour(commerces: Commerce[], maintenant: Date = new Date()): Tache[] {
  const jour = aujourdhuiParis(maintenant);
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
  return commerces
    .filter((c) => !c.archivee_le && c.etape !== "perdu" && c.prochaine_action_le && c.prochaine_action_le <= jour)
    .map((c) => ({ commerce: c, retard: Math.round((ms(jour) - ms(c.prochaine_action_le as string)) / 86_400_000) }))
    .sort((a, b) => b.retard - a.retard || a.commerce.nom.localeCompare(b.commerce.nom, "fr"));
}

/** Minuscules, sans accents : « Pâtisserie » trouve « patisserie ». */
export const normaliser = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface Filtres {
  q?: string;
  etape?: string;
  metier?: string;
  ville?: string;
  /** Inclure les fiches masquées (archivées). */
  archives?: boolean;
}

/** Recherche instantanée sur nom, métier, ville, contact, téléphone et notes ; filtres exacts (sans accents). */
export function filtrerCommerces(commerces: Commerce[], f: Filtres): Commerce[] {
  const mots = normaliser(f.q).split(/\s+/).filter(Boolean);
  const telQ = (f.q ?? "").replace(/\D/g, "");
  return commerces.filter((c) => {
    if (!f.archives && c.archivee_le) return false;
    if (f.etape && c.etape !== f.etape) return false;
    if (f.metier && normaliser(c.metier) !== normaliser(f.metier)) return false;
    if (f.ville && normaliser(c.ville) !== normaliser(f.ville)) return false;
    if (!mots.length) return true;
    const foin = normaliser([c.nom, c.metier, c.ville, c.contact_prenom, c.adresse, c.notes, c.instagram].join(" "));
    const tel = (c.telephone ?? "").replace(/\D/g, "");
    return mots.every((m) => foin.includes(m)) || (telQ.length >= 4 && tel.includes(telQ));
  });
}

/** Regroupement pour le kanban, dans l'ordre des étapes ; chaque colonne triée par prochaine action puis nom. */
export function parEtape(commerces: Commerce[], etapes: readonly { id: string }[]): Record<string, Commerce[]> {
  const res: Record<string, Commerce[]> = Object.fromEntries(etapes.map((e) => [e.id, [] as Commerce[]]));
  for (const c of commerces) (res[c.etape] ??= []).push(c);
  for (const liste of Object.values(res)) {
    liste.sort((a, b) => (a.prochaine_action_le ?? "9999").localeCompare(b.prochaine_action_le ?? "9999") || a.nom.localeCompare(b.nom, "fr"));
  }
  return res;
}

/** Valeurs distinctes (métiers, villes) pour les filtres, triées sans accents. */
export function valeursDistinctes(commerces: Commerce[], champ: "metier" | "ville"): string[] {
  const vus = new Map<string, string>();
  for (const c of commerces) {
    const v = c[champ]?.trim();
    if (v && !vus.has(normaliser(v))) vus.set(normaliser(v), v);
  }
  return [...vus.values()].sort((a, b) => normaliser(a).localeCompare(normaliser(b)));
}
