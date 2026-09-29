import { Store } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { locationsLine, storedProfile } from "@/lib/emails/business-profile";
import type { Prospect } from "@/types";

/**
 * Profil métier lu sur le site : ce qu'ils vendent, à qui, comment arrivent
 * commandes et devis, implantations, services. C'est ce que lit le stratège
 * pour choisir le pain — l'afficher permet de vérifier qu'il a bien compris.
 */
export function BusinessProfileCard({ prospect }: { prospect: Prospect }) {
  const profile = storedProfile(prospect.business_profile);

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Store className="h-4 w-4 text-primary" aria-hidden />
        <CardTitle>Profil métier</CardTitle>
        {prospect.business_profile_at && (
          <span className="font-data ml-auto text-[11px] text-faint">lu le {formatDate(prospect.business_profile_at)}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-2.5 text-[13px]">
        {!profile ? (
          <p className="text-muted">
            {prospect.website
              ? "Pas encore lu : « Relancer l'analyse » (Prospection) lit le site et remplit ce profil."
              : "Aucun site connu : le profil métier ne peut pas être lu, le pain sera choisi avec prudence."}
          </p>
        ) : (
          <>
            <Row label="Ce qu'ils vendent" value={profile.offer} />
            <Row
              label="Clientèle"
              value={`${profile.customers}${profile.customerDetail ? ` — ${profile.customerDetail}` : ""}`}
            />
            <Row label="Commandes et devis" value={profile.demandChannels.join(" · ") || null} />
            <Row label="Implantations" value={locationsLine(profile)} />
            {profile.services.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-faint">Services</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {profile.services.map((item) => (
                    <Badge key={item.name} tone="info" title={item.quote}>
                      {item.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {profile.commercialName && <Row label="Nom commercial" value={profile.commercialName} />}
            {profile.dropped.length > 0 && (
              <p className="text-[11px] text-faint" title={profile.dropped.join("\n")}>
                {profile.dropped.length} élément(s) écarté(s) faute de citation sur le site.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
      <p className="mt-0.5 text-text">{value}</p>
    </div>
  );
}
