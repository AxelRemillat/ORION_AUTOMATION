"use client";

/**
 * En-tête de la fiche (Cowork #117) : contacts en un geste (appeler, Instagram, fiche Google, site, maquette), étape,
 * prochaine action avec « Fait », lien futur vers la plateforme (désactivé), masquer / réafficher.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Check, ExternalLink, Globe, Instagram, MapPin, Phone, Rocket } from "lucide-react";
import { Badge, Button, Input, Select, useToast } from "@/components/ui";
import { archiverCommerce, terminerAction } from "@/app/(app)/crm/actions";
import { ETAPES, libelleCanal, libelleEtape, type Commerce, type Offre } from "@/lib/crm/types";
import { useDeplacer } from "./deplacer";
import { CLASSE_URGENCE, echeance, euros, jourCourt, TON_ETAPE } from "./outils";

const Lien = ({ href, icone: Icone, children }: { href: string; icone: typeof Phone; children: React.ReactNode }) => (
  <a
    href={href}
    target={href.startsWith("http") ? "_blank" : undefined}
    rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-text hover:border-primary/40"
  >
    <Icone className="size-4 text-primary-ink" aria-hidden />
    {children}
  </a>
);

export function FicheEntete({ c, offres, aujourdhui }: { c: Commerce; offres: Offre[]; aujourdhui: string }) {
  const router = useRouter();
  const toast = useToast();
  const { deplacer, fenetre } = useDeplacer();
  const [enCours, demarrer] = useTransition();
  const [suite, setSuite] = useState({ texte: "", le: "" });
  const [faitOuvert, setFaitOuvert] = useState(false);
  const e = echeance(c.prochaine_action_le, aujourdhui);
  const offre = offres.find((o) => o.id === c.offre_id);
  const instagram = c.instagram ? `https://www.instagram.com/${c.instagram.replace(/^@/, "")}/` : null;

  const fait = () =>
    demarrer(async () => {
      const r = await terminerAction(c.id, { prochaineAction: suite.texte, prochaineActionLe: suite.le });
      if (!r.ok) return toast.error(r.error);
      toast.success("Action notée dans la chronologie");
      setFaitOuvert(false);
      setSuite({ texte: "", le: "" });
      router.refresh();
    });

  const archiver = () =>
    demarrer(async () => {
      const r = await archiverCommerce(c.id, !c.archivee_le);
      if (!r.ok) return toast.error(r.error);
      toast.success(c.archivee_le ? "Fiche réaffichée" : "Fiche masquée (rien n'est supprimé)");
      router.refresh();
    });

  return (
    <div className="grid gap-4">
      {c.archivee_le && (
        <p role="note" className="rounded-xl border border-warn/25 bg-warn/10 px-3 py-2 text-sm text-warn-ink">
          Fiche masquée le {jourCourt(c.archivee_le.slice(0, 10))} : elle n&apos;apparaît plus dans le CRM, mais rien n&apos;est supprimé.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone={TON_ETAPE[c.etape]}>{libelleEtape(c.etape)}</Badge>
        {c.metier && <span>{c.metier}</span>}
        {c.ville && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden />
            {c.ville}
          </span>
        )}
        <span className="text-faint">· {libelleCanal(c.canal)}</span>
        {c.contact_prenom && <span className="text-faint">· {[c.contact_prenom, c.contact_role].filter(Boolean).join(", ")}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {c.telephone && (
          <Lien href={`tel:${c.telephone.replace(/[^\d+]/g, "")}`} icone={Phone}>
            {c.telephone}
          </Lien>
        )}
        {instagram && (
          <Lien href={instagram} icone={Instagram}>
            {c.instagram}
          </Lien>
        )}
        {c.fiche_google && (
          <Lien href={c.fiche_google} icone={MapPin}>
            Fiche Google
          </Lien>
        )}
        {c.site_url && (
          <Lien href={c.site_url} icone={Globe}>
            Site
          </Lien>
        )}
        {c.maquette_url && (
          <Lien href={c.maquette_url} icone={ExternalLink}>
            Maquette Studio
          </Lien>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">Étape</p>
          <Select aria-label="Changer l'étape" value={c.etape} onChange={(ev) => deplacer(c.id, c.nom, ev.target.value)}>
            {ETAPES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.libelle}
              </option>
            ))}
          </Select>
          {c.etape === "perdu" && c.motif_perte && <p className="mt-2 text-sm text-lost-ink">Motif : {c.motif_perte}</p>}
          {(offre || c.montant_devis !== null || c.date_signature) && (
            <p className="mt-2 text-sm text-muted">
              {offre?.libelle}
              {c.montant_devis !== null && <span className="font-data"> · {euros(c.montant_devis)}</span>}
              {c.date_signature && <span> · signé le {jourCourt(c.date_signature)}</span>}
            </p>
          )}
          <p className="mt-1 text-xs text-muted">
            Accord de démonstration : {c.accord_demo ? <span className="text-good-ink">signé{c.accord_demo_le ? ` le ${jourCourt(c.accord_demo_le)}` : ""}</span> : "non"}
          </p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted">Prochaine action</p>
          {c.prochaine_action || e ? (
            <p className="text-sm text-text">
              {e && <span className={`font-data ${CLASSE_URGENCE[e.urgence]}`}>{e.texte} · </span>}
              {c.prochaine_action ?? "—"}
            </p>
          ) : (
            <p className="text-sm text-muted">Aucune. Ajoutez-en une depuis la chronologie.</p>
          )}
          {(c.prochaine_action || e) && !faitOuvert && (
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setFaitOuvert(true)}>
              <Check className="size-4" aria-hidden />
              Fait
            </Button>
          )}
          {faitOuvert && (
            <div className="mt-2 grid gap-2">
              <Input value={suite.texte} onChange={(ev) => setSuite({ ...suite, texte: ev.target.value })} placeholder="Action suivante (facultatif)" aria-label="Action suivante" />
              <div className="flex gap-2">
                <Input type="date" value={suite.le} onChange={(ev) => setSuite({ ...suite, le: ev.target.value })} aria-label="Date de l'action suivante" />
                <Button size="sm" onClick={fait} loading={enCours}>
                  Valider
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled
          title="Bientôt : l'API de la plateforme mon-site.webdesartisans.fr (agent3) n'est pas encore disponible."
          aria-describedby="plateforme-aide"
        >
          <Rocket className="size-4" aria-hidden />
          Créer l&apos;espace client sur la plateforme
        </Button>
        <span id="plateforme-aide" className="text-xs text-faint">
          Bientôt disponible : la plateforme n&apos;est pas encore reliée.
        </span>
        <Button variant="ghost" onClick={archiver} disabled={enCours} className="ml-auto">
          {c.archivee_le ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
          {c.archivee_le ? "Réafficher" : "Masquer la fiche"}
        </Button>
      </div>
      {fenetre}
    </div>
  );
}
