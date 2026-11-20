"use server";

// Actions de la comptabilité : formulaires simples (aucun JavaScript requis), erreurs métier renvoyées dans l'URL
// (?erreur=…) et affichées par la page. Les règles fortes sont vérifiées par la base (numéro, immuabilité, avoir).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gardeCompta } from "@/lib/compta/acces";
import { lireEuros } from "@/lib/compta/calculs";
import { COMPTA_CONFIG } from "@/lib/compta/config";
import { depot } from "@/lib/compta/contexte";
import type { Ligne, MoyenPaiement, StatutDevis } from "@/lib/compta/types";

const texte = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const entier = (fd: FormData, k: string, defaut: number) => {
  const n = Number(texte(fd, k));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : defaut;
};

/** Lignes saisies (designation_i, quantite_i, prix_i) ; les lignes vides sont ignorées. */
function lignes(fd: FormData): Ligne[] {
  const sortie: Ligne[] = [];
  for (let i = 0; i < 12; i++) {
    const designation = texte(fd, `designation_${i}`);
    if (!designation) continue;
    const quantite = Number(texte(fd, `quantite_${i}`).replace(",", ".") || "1");
    const prix = lireEuros(texte(fd, `prix_${i}`));
    if (!Number.isFinite(quantite) || quantite <= 0 || prix === null) throw new Error(`Ligne « ${designation} » : quantité ou prix illisible`);
    sortie.push({ designation, quantite, prix_unitaire: prix });
  }
  return sortie;
}

/** Exécute, puis redirige ; une erreur revient sur `retour` avec son message. */
async function faire(retour: string, f: () => Promise<string | void>): Promise<never> {
  await gardeCompta();
  let suite: string | void;
  try {
    suite = await f();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Action impossible";
    redirect(`${retour}${retour.includes("?") ? "&" : "?"}erreur=${encodeURIComponent(message.slice(0, 200))}`);
  }
  revalidatePath("/compta", "layout");
  redirect(suite || retour);
}

export async function enregistrerParametres(fd: FormData) {
  await faire("/compta/parametres", async () => {
    const d = await depot();
    await d.enregistrerParametres({
      nom: texte(fd, "nom"),
      adresse: texte(fd, "adresse"),
      siret: texte(fd, "siret"),
      email: texte(fd, "email") || null,
      telephone: texte(fd, "telephone") || null,
      iban: texte(fd, "iban") || null,
      date_debut_activite: texte(fd, "date_debut_activite") || null,
      acre: fd.get("acre") === "on",
    });
    return "/compta/parametres?ok=1";
  });
}

export async function creerClient(fd: FormData) {
  await faire("/compta/clients", async () => {
    await (await depot()).creerClient({
      nom: texte(fd, "nom"),
      professionnel: fd.get("professionnel") === "on",
      siren: texte(fd, "siren") || null,
      adresse: texte(fd, "adresse"),
      email: texte(fd, "email") || null,
      crm_ref: texte(fd, "crm_ref") || null,
    });
  });
}

export async function creerDevis(fd: FormData) {
  await faire("/compta/devis/nouveau", async () => {
    const id = await (await depot()).creerDevis({
      client_id: texte(fd, "client_id"),
      objet: texte(fd, "objet"),
      lignes: lignes(fd),
      validite_jours: entier(fd, "validite_jours", COMPTA_CONFIG.validiteDevisJours),
      conditions: texte(fd, "conditions"),
    });
    return `/compta/devis/${id}`;
  });
}

export async function changerStatutDevis(fd: FormData) {
  const id = texte(fd, "id");
  await faire(`/compta/devis/${id}`, async () => (await depot()).modifierDevis(id, { statut: texte(fd, "statut") as StatutDevis }));
}

export async function devisEnFacture(fd: FormData) {
  const id = texte(fd, "id");
  await faire(`/compta/devis/${id}`, async () => `/compta/factures/${await (await depot()).devisVersFacture(id)}`);
}

export async function creerFacture(fd: FormData) {
  await faire("/compta/factures/nouvelle", async () => {
    const id = await (await depot()).creerFacture({
      client_id: texte(fd, "client_id"),
      objet: texte(fd, "objet"),
      lignes: lignes(fd),
      date_prestation: texte(fd, "date_prestation"),
      echeance_jours: Math.min(60, entier(fd, "echeance_jours", COMPTA_CONFIG.echeanceJours)),
    });
    return `/compta/factures/${id}`;
  });
}

export async function completerBrouillon(fd: FormData) {
  const id = texte(fd, "id");
  await faire(`/compta/factures/${id}`, async () => (await depot()).modifierBrouillon(id, { date_prestation: texte(fd, "date_prestation"), echeance_jours: Math.min(60, entier(fd, "echeance_jours", 30)) }));
}

export async function supprimerBrouillon(fd: FormData) {
  const id = texte(fd, "id");
  await faire(`/compta/factures/${id}`, async () => ((await (await depot()).supprimerBrouillon(id)), "/compta/factures"));
}

export async function emettreFacture(fd: FormData) {
  const id = texte(fd, "id");
  await faire(`/compta/factures/${id}`, async () => void (await (await depot()).emettre(id)));
}

export async function emettreAvoir(fd: FormData) {
  const id = texte(fd, "facture_id");
  await faire(`/compta/factures/${id}`, async () => {
    const montant = lireEuros(texte(fd, "montant"));
    if (!montant || montant <= 0) throw new Error("Montant de l'avoir illisible");
    const d = await depot();
    const avoir = await d.creerAvoir(id, [{ designation: texte(fd, "designation") || "Avoir", quantite: 1, prix_unitaire: montant }], texte(fd, "motif"));
    try {
      await d.emettre(avoir);
    } catch (e) {
      await d.supprimerBrouillon(avoir); // brouillon jamais émis : retiré, aucun numéro n'a été pris
      throw e;
    }
    return `/compta/factures/${avoir}`;
  });
}

export async function creerEncaissement(fd: FormData) {
  const retour = texte(fd, "retour") || "/compta/recettes";
  await faire(retour, async () => {
    const montant = lireEuros(texte(fd, "montant"));
    if (!montant) throw new Error("Montant illisible");
    await (await depot()).creerEncaissement({
      date: texte(fd, "date"),
      montant,
      moyen: texte(fd, "moyen") as MoyenPaiement,
      facture_id: texte(fd, "facture_id") || null,
      client_id: texte(fd, "client_id"),
      nature: texte(fd, "nature"),
      reference: texte(fd, "reference") || null,
    });
  });
}

export async function creerDepense(fd: FormData) {
  await faire("/compta/depenses", async () => {
    const montant = lireEuros(texte(fd, "montant"));
    if (!montant || montant <= 0) throw new Error("Montant illisible");
    const fichier = fd.get("justificatif");
    const justificatif =
      fichier instanceof File && fichier.size > 0
        ? fichier.size > 10_000_000
          ? (() => {
              throw new Error("Justificatif trop lourd (10 Mo au plus)");
            })()
          : { nom: fichier.name, type: fichier.type || "application/octet-stream", octets: new Uint8Array(await fichier.arrayBuffer()) }
        : undefined;
    await (await depot()).creerDepense({ date: texte(fd, "date"), montant, fournisseur: texte(fd, "fournisseur"), nature: texte(fd, "nature") }, justificatif);
  });
}

export async function marquerDeclare(fd: FormData) {
  await faire("/compta/urssaf", async () =>
    (await depot()).marquerDeclare(Number(texte(fd, "annee")), Number(texte(fd, "trimestre")) as 1 | 2 | 3 | 4, Number(texte(fd, "montant"))),
  );
}
