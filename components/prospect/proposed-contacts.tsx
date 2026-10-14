"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX } from "lucide-react";
import { Badge, Button, Card, CardContent, useToast } from "@/components/ui";
import { setPrimaryContactAction } from "@/lib/outbox/actions";
import type { ProposedContact } from "@/lib/inbound/departed";

const FAMILY = { operations: "opérations / logistique", commercial: "commercial", autre: "autre" } as const;

/**
 * Contact PARTI et contacts PROPOSÉS (Cowork #54) : l'adresse morte est
 * rappelée (plus aucune relance n'y part) ; les personnes citées dans la
 * réponse automatique sont proposées. Rien d'automatique : « Utiliser comme
 * contact principal » est l'action d'Axel, et ne reprogramme aucune relance.
 */
export function ProposedContacts({ prospectId, departed, proposed, current }: { prospectId: string; departed: string[]; proposed: ProposedContact[]; current: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  if (!departed.length && !proposed.length) return null;

  function choose(email: string) {
    startTransition(async () => {
      const result = await setPrimaryContactAction(prospectId, email);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${email} devient le contact principal. Aucune relance n'a été reprogrammée.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 text-[13px]">
        <p className="flex items-center gap-2 font-medium text-text">
          <UserX className="h-4 w-4 text-lost-ink" aria-hidden />
          Contact parti
        </p>
        {departed.map((email) => (
          <p key={email} className="text-muted">
            <span className="font-data text-text line-through">{email}</span> a quitté l&apos;entreprise : plus aucune relance vers cette adresse.
          </p>
        ))}
        {proposed.length > 0 && <p className="text-[12px] text-muted">Contacts cités dans la réponse :</p>}
        {proposed.map((contact) => (
          <div key={contact.email} className="flex flex-wrap items-center gap-2">
            <span className="text-text">{contact.name ?? "—"}</span>
            <span className="font-data text-text">{contact.email}</span>
            {contact.role && <span className="text-muted">({contact.role})</span>}
            <Badge tone="neutral">{FAMILY[contact.family]}</Badge>
            {contact.suggested && <Badge tone="info">suggéré</Badge>}
            {current?.toLowerCase() === contact.email ? (
              <Badge tone="success">contact principal</Badge>
            ) : (
              <Button size="sm" variant={contact.suggested ? "secondary" : "ghost"} loading={pending} onClick={() => choose(contact.email)}>
                Utiliser comme contact principal
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
