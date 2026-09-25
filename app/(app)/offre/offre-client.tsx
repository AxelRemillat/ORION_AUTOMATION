"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { postJson } from "@/lib/enrichment/api-client";
import { isOfferComplete, signatureFor } from "@/lib/offer/model";
import { ENTRY_OFFER_LABELS, type EntryOfferType, type OfferProof, type UserOffer } from "@/types";

/**
 * Édition de l'offre.
 *
 * Un seul formulaire, enregistré d'un bloc : ces champs se lisent ensemble
 * quand un mail se construit, et les enregistrer séparément laisserait des
 * états intermédiaires incohérents — une signature sans titre, une preuve sans
 * phrase.
 *
 * L'aperçu de signature est affiché en direct : c'est le seul endroit où Axel
 * voit ce que le destinataire verra.
 */
export function OffreClient({ initial, empty }: { initial: UserOffer; empty: boolean }) {
  const toast = useToast();
  const [offer, setOffer] = useState<UserOffer>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof UserOffer>(key: K, value: UserOffer[K]) =>
    setOffer((current) => ({ ...current, [key]: value }));

  const setProof = (index: number, patch: Partial<OfferProof>) =>
    setOffer((current) => ({
      ...current,
      proofs: current.proofs.map((proof, i) => (i === index ? { ...proof, ...patch } : proof)),
    }));

  async function save() {
    setSaving(true);
    try {
      await postJson("/api/offer", { offer });
      toast.success("Offre enregistrée. Les prochains mails s'en servent.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  const complete = isOfferComplete(offer);

  return (
    <div className="flex flex-col gap-4">
      {(empty || !complete) && (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="p-4 text-[13px] text-text">
            {empty
              ? "Rien n'est encore enregistré : les valeurs ci-dessous sont un préremplissage, à relire puis enregistrer."
              : "Il manque l'essentiel (nom, titre, demande d'entrée ou une preuve publique) : les mails resteront impersonnels."}
          </CardContent>
        </Card>
      )}

      {/* --- Signature ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Signature</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="nom">Nom complet</Label>
            <Input id="nom" value={offer.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="titre">Titre (une ligne)</Label>
            <Input id="titre" value={offer.title ?? ""} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="portfolio">Portfolio</Label>
            <Input id="portfolio" value={offer.portfolio_url ?? ""} onChange={(e) => set("portfolio_url", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tel">Téléphone</Label>
            <Input id="tel" value={offer.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
            <label className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
              <input
                type="checkbox"
                checked={offer.show_phone}
                onChange={(e) => set("show_phone", e.target.checked)}
              />
              Afficher le téléphone dans la signature
            </label>
          </div>

          <div className="sm:col-span-2">
            <Label>Aperçu</Label>
            <pre
              className="mt-1 whitespace-pre-wrap rounded-lg border p-3 font-data text-[12px] leading-relaxed"
              style={{ borderColor: "var(--line-soft)", background: "var(--surface-2)", color: "var(--text)" }}
            >
              {signatureFor(offer)}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* --- Offre d'entrée -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Demande d&apos;entrée</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="type">Type</Label>
            <Select
              id="type"
              value={offer.entry_type ?? "demo"}
              onChange={(e) => set("entry_type", e.target.value as EntryOfferType)}
            >
              {Object.entries(ENTRY_OFFER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="duree">Durée</Label>
            <Input id="duree" value={offer.entry_duration ?? ""} onChange={(e) => set("entry_duration", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="pitch">Phrase courte</Label>
            <Textarea
              id="pitch"
              rows={2}
              value={offer.entry_pitch ?? ""}
              onChange={(e) => set("entry_pitch", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="lien">Lien</Label>
            <Input id="lien" value={offer.entry_url ?? ""} onChange={(e) => set("entry_url", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {/* --- Promesse -------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Promesse</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="max-w-xs">
            <Label htmlFor="delai">Délai de mise en place type</Label>
            <Input id="delai" value={offer.lead_time ?? ""} onChange={(e) => set("lead_time", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input type="checkbox" checked={offer.no_tool_change} onChange={(e) => set("no_tool_change", e.target.checked)} />
            Sans changer d&apos;outil
          </label>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={offer.human_validation}
              onChange={(e) => set("human_validation", e.target.checked)}
            />
            Validation humaine avant chaque action
          </label>
        </CardContent>
      </Card>

      {/* --- Preuves --------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Preuves</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setOffer((current) => ({
                ...current,
                proofs: [
                  ...current.proofs,
                  { id: `preuve-${current.proofs.length + 1}`, title: "", sentence: "", tags: [], url: null, publicOk: true },
                ],
              }))
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Ajouter
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12px] leading-snug text-muted">
            Une seule preuve métier par mail, choisie par recoupement entre ses mots-clés et le
            problème identifié. Sans recoupement, le mail n&apos;en cite aucune — mieux vaut rien
            qu&apos;une référence à côté.
          </p>

          {offer.proofs.map((proof, index) => (
            <div
              key={`${proof.id}-${index}`}
              className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
              style={{ borderColor: "var(--line-soft)" }}
            >
              <div>
                <Label htmlFor={`id-${index}`}>Identifiant</Label>
                <Input id={`id-${index}`} value={proof.id} onChange={(e) => setProof(index, { id: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`titre-${index}`}>Titre</Label>
                <Input id={`titre-${index}`} value={proof.title} onChange={(e) => setProof(index, { title: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`phrase-${index}`}>Phrase publique (une ligne)</Label>
                <Textarea
                  id={`phrase-${index}`}
                  rows={2}
                  value={proof.sentence}
                  onChange={(e) => setProof(index, { sentence: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`tags-${index}`}>Mots-clés métier (séparés par des virgules)</Label>
                <Input
                  id={`tags-${index}`}
                  value={proof.tags.join(", ")}
                  onChange={(e) =>
                    setProof(index, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`url-${index}`}>Lien (optionnel)</Label>
                <Input id={`url-${index}`} value={proof.url ?? ""} onChange={(e) => setProof(index, { url: e.target.value })} />
              </div>

              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    checked={proof.publicOk}
                    onChange={(e) => setProof(index, { publicOk: e.target.checked })}
                  />
                  Citable dans un mail
                  {!proof.publicOk && <Badge tone="warning">jamais citée</Badge>}
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setOffer((current) => ({ ...current, proofs: current.proofs.filter((_, i) => i !== index) }))
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Retirer
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          <Save className="h-4 w-4" aria-hidden />
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
