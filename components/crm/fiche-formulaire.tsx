"use client";

/**
 * Formulaire complet d'une fiche (Cowork #117) : identité, contact, présence en ligne, SIREN (annuaire GRATUIT de
 * l'État, au choix d'Axel), Web des Artisans (offre, devis, signature, accord de démonstration), notes.
 * Seuls les champs modifiés comptent : le serveur ne réécrit que ce qui est envoyé.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, Label, Select, Textarea, useToast } from "@/components/ui";
import { chercherSirenCommerce, modifierCommerce } from "@/app/(app)/crm/actions";
import type { CandidatSiren } from "@/lib/crm/siren";
import { CANAUX, type Commerce, type Offre } from "@/lib/crm/types";
import { euros } from "./outils";

const Champ = ({ id, libelle, children, erreur, large }: { id: string; libelle: string; children: React.ReactNode; erreur?: string; large?: boolean }) => (
  <div className={large ? "sm:col-span-2" : undefined}>
    <Label htmlFor={id}>{libelle}</Label>
    {children}
    {erreur && (
      <p role="alert" className="mt-1 text-xs text-lost-ink">
        {erreur}
      </p>
    )}
  </div>
);

export function FicheFormulaire({ c, offres }: { c: Commerce; offres: Offre[] }) {
  const router = useRouter();
  const toast = useToast();
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [siren, setSiren] = useState(c.siren ?? "");
  const [candidats, setCandidats] = useState<CandidatSiren[] | null>(null);
  const [accord, setAccord] = useState(c.accord_demo);
  const [enCours, demarrer] = useTransition();
  const [recherche, demarrerRecherche] = useTransition();

  const envoyer = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget).entries());
    d.accord_demo = accord;
    if (d.site_existant === "") d.site_existant = null;
    demarrer(async () => {
      const r = await modifierCommerce(c.id, d);
      if (!r.ok) {
        setErreurs(r.erreurs ?? {});
        return toast.error(r.error);
      }
      setErreurs({});
      toast.success("Fiche enregistrée");
      router.refresh();
    });
  };

  const chercher = () =>
    demarrerRecherche(async () => {
      const r = await chercherSirenCommerce(c.nom, c.ville);
      if (!r.ok) return toast.error(r.error);
      setCandidats(r.candidats);
      if (!r.candidats.length) toast.toast("Aucun établissement trouvé dans l'annuaire.");
    });

  return (
    <form onSubmit={envoyer} className="grid gap-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-display text-base text-text">Le commerce</legend>
        <Champ id="f-nom" libelle="Nom *" erreur={erreurs.nom}>
          <Input id="f-nom" name="nom" defaultValue={c.nom} required />
        </Champ>
        <Champ id="f-metier" libelle="Métier">
          <Input id="f-metier" name="metier" defaultValue={c.metier ?? ""} />
        </Champ>
        <Champ id="f-ville" libelle="Ville">
          <Input id="f-ville" name="ville" defaultValue={c.ville ?? ""} />
        </Champ>
        <Champ id="f-adresse" libelle="Adresse">
          <Input id="f-adresse" name="adresse" defaultValue={c.adresse ?? ""} autoComplete="street-address" />
        </Champ>
        <Champ id="f-canal" libelle="Canal d'origine" erreur={erreurs.canal}>
          <Select id="f-canal" name="canal" defaultValue={c.canal}>
            {CANAUX.map((x) => (
              <option key={x.id} value={x.id}>
                {x.libelle}
              </option>
            ))}
          </Select>
        </Champ>
        <Champ id="f-siren" libelle="SIREN (facultatif)" erreur={erreurs.siren}>
          <div className="flex gap-2">
            <Input id="f-siren" name="siren" value={siren} onChange={(e) => setSiren(e.target.value)} inputMode="numeric" className="font-data" />
            <Button type="button" variant="outline" onClick={chercher} loading={recherche} title="Annuaire gratuit de l'État, aucun crédit">
              Chercher
            </Button>
          </div>
          {candidats && candidats.length > 0 && (
            <ul className="mt-2 grid gap-1 rounded-lg border border-line bg-surface-2/60 p-2 text-sm">
              {candidats.map((x) => (
                <li key={x.siren}>
                  <button
                    type="button"
                    onClick={() => {
                      setSiren(x.siren);
                      setCandidats(null);
                    }}
                    className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface"
                  >
                    <span className="font-data">{x.siren}</span> · {x.nom}
                    <span className="block text-xs text-muted">
                      {[x.codePostal, x.commune].filter(Boolean).join(" ")} {x.enActivite ? "" : "· fermé"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Champ>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-display text-base text-text">Contact et présence en ligne</legend>
        <Champ id="f-prenom" libelle="Prénom du contact">
          <Input id="f-prenom" name="contact_prenom" defaultValue={c.contact_prenom ?? ""} />
        </Champ>
        <Champ id="f-role" libelle="Rôle">
          <Input id="f-role" name="contact_role" defaultValue={c.contact_role ?? ""} placeholder="Gérant, associée…" />
        </Champ>
        <Champ id="f-tel" libelle="Téléphone">
          <Input id="f-tel" name="telephone" type="tel" defaultValue={c.telephone ?? ""} />
        </Champ>
        <Champ id="f-insta" libelle="Instagram">
          <Input id="f-insta" name="instagram" defaultValue={c.instagram ?? ""} placeholder="@compte" />
        </Champ>
        <Champ id="f-google" libelle="Fiche Google" erreur={erreurs.fiche_google}>
          <Input id="f-google" name="fiche_google" type="url" defaultValue={c.fiche_google ?? ""} />
        </Champ>
        <Champ id="f-site-existe" libelle="Site existant">
          <Select id="f-site-existe" name="site_existant" defaultValue={c.site_existant === null ? "" : c.site_existant ? "oui" : "non"}>
            <option value="">Je ne sais pas</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </Select>
        </Champ>
        <Champ id="f-site" libelle="Adresse du site" erreur={erreurs.site_url} large>
          <Input id="f-site" name="site_url" type="url" defaultValue={c.site_url ?? ""} />
        </Champ>
        <Champ id="f-maquette" libelle="Maquette du Studio (lien)" erreur={erreurs.maquette_url} large>
          <Input id="f-maquette" name="maquette_url" type="url" defaultValue={c.maquette_url ?? ""} placeholder="https://…" />
        </Champ>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-display text-base text-text">Web des Artisans</legend>
        <Champ id="f-offre" libelle="Offre choisie">
          <Select id="f-offre" name="offre_id" defaultValue={c.offre_id ?? ""}>
            <option value="">—</option>
            {offres.filter((o) => o.active || o.id === c.offre_id).map((o) => (
              <option key={o.id} value={o.id}>
                {o.libelle}
                {o.prix_indicatif !== null ? ` (${euros(o.prix_indicatif)})` : ""}
              </option>
            ))}
          </Select>
        </Champ>
        <Champ id="f-montant" libelle="Montant du devis (€)" erreur={erreurs.montant_devis}>
          <Input id="f-montant" name="montant_devis" inputMode="decimal" defaultValue={c.montant_devis ?? ""} className="font-data" />
        </Champ>
        <Champ id="f-signature" libelle="Date de signature">
          <Input id="f-signature" name="date_signature" type="date" defaultValue={c.date_signature ?? ""} />
        </Champ>
        <div className="rounded-xl border border-line bg-surface-2/60 p-3 sm:col-span-2">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={accord} onChange={(e) => setAccord(e.target.checked)} className="mt-1 size-5 accent-[var(--primary)]" />
            <span>
              <span className="block text-sm font-medium text-text">Accord de démonstration signé</span>
              <span className="block text-xs text-muted">Autorise à montrer le site et ses chiffres à des prospects.</span>
            </span>
          </label>
          {accord && (
            <div className="mt-2 max-w-[12rem]">
              <Label htmlFor="f-accord-le">Signé le</Label>
              <Input id="f-accord-le" name="accord_demo_le" type="date" defaultValue={c.accord_demo_le ?? ""} />
            </div>
          )}
        </div>
      </fieldset>

      <Champ id="f-notes" libelle="Notes">
        <Textarea id="f-notes" name="notes" defaultValue={c.notes ?? ""} rows={4} />
      </Champ>

      <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" loading={enCours} className="w-full sm:w-auto">
          Enregistrer la fiche
        </Button>
      </div>
    </form>
  );
}
