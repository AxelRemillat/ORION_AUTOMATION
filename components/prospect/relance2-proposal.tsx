import { UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import type { Relance2Contact } from "@/lib/contact-finder/relance2";

/**
 * Contact nominatif PROPOSÉ pour la relance 2 (Cowork #52) : l'intro et la
 * relance 1 sont parties sur une adresse générique. Proposition seulement —
 * rien n'est envoyé ni reprogrammé ici ; l'agent rédactionnel la lit.
 */
export function Relance2Proposal({ figures }: { figures: unknown }) {
  const proposal = (figures as { relance2_contact?: Relance2Contact } | null)?.relance2_contact;
  if (!proposal?.email) return null;
  const who = [proposal.name, proposal.role].filter(Boolean).join(" — ");
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div className="text-[13px]">
          <p className="font-medium text-text">Relance 2 : contact proposé</p>
          <p className="text-text">
            {who ? `${who} · ` : ""}
            <span className="font-data">{proposal.email}</span>
          </p>
          <p className="text-[12px] text-muted">
            Au lieu de {proposal.instead_of ?? "l'adresse générique"} · Hunter, {proposal.verifier}, confiance {proposal.confidence} %. Proposition : rien n&apos;est envoyé.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
