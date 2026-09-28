"use client";

import { useState } from "react";
import { ExternalLink, Globe, Mail, SearchCheck } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import type { Prospect } from "@/types";
import { useContactFinder, type ContactFields } from "./use-contact-finder";

/** Libellé lisible du chemin qui a produit l'adresse. */
function foundByLabel(value: string | null | undefined): string {
  if (!value) return "saisie ou enrichissement";
  if (value.startsWith("site:")) return `site officiel — ${value.slice(5).replace(/^linkup:.*/, "recherche web")}`;
  if (value.includes("email-finder")) return "Hunter (dirigeant) + vérification";
  if (value.includes("domain-search")) return "Hunter (domaine)";
  return value;
}

/**
 * Contact de la fiche : site officiel ÉDITABLE, adresse avec sa provenance
 * cliquable, et le bouton qui relance la recherche (lib/contact-finder).
 * Saisir un site puis relancer : la recherche part de ce site.
 */
export function ContactCard({ prospect }: { prospect: Pick<Prospect, "id" | "company_name"> & ContactFields }) {
  const { fields, running, step, error, find } = useContactFinder(prospect);
  const [site, setSite] = useState(prospect.website ?? "");
  const nominal = fields.email_type === "nominatif";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Mail className="h-4 w-4 text-primary" aria-hidden />
          Contact
        </CardTitle>
        {typeof fields.contact_confidence === "number" && (
          <span className="font-data text-[12px] text-muted">confiance {fields.contact_confidence} %</span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fields.email ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={`mailto:${fields.email}`} className="font-data text-[13px] text-text hover:text-primary-ink">
              {fields.email}
            </a>
            {fields.email_type && <Badge tone={nominal ? "success" : "neutral"}>{nominal ? "nominatif" : "générique"}</Badge>}
          </div>
        ) : (
          <p className="text-[13px] text-muted">Aucune adresse : la programmation d&apos;un envoi reste impossible.</p>
        )}

        {fields.email && (
          <p className="text-[12px] text-muted">
            Trouvée par {foundByLabel(fields.contact_found_by)}
            {fields.email_source_url && (
              <>
                {" · "}
                <a href={fields.email_source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-ink underline-offset-2 hover:underline">
                  voir la source <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </>
            )}
          </p>
        )}

        <label className="flex flex-col gap-1 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" aria-hidden /> Site officiel
          </span>
          <Input value={site} onChange={(event) => setSite(event.target.value)} placeholder="exemple.fr" disabled={running} />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" loading={running} onClick={() => find(site !== (prospect.website ?? "") ? site : null)}>
            <SearchCheck className="h-4 w-4" aria-hidden />
            Trouver le contact (IA)
          </Button>
          {step && <span className="text-[12px] text-muted">{step}</span>}
        </div>
        {error && <p role="alert" className="text-[12px] text-lost-ink">{error}</p>}
      </CardContent>
    </Card>
  );
}
