"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui";
import { validateAntispam } from "@/lib/outbox/actions";

/**
 * Challenge anti-spam (Mailinblack…) : le lien de validation, ouvert dans un
 * nouvel onglet — proposé seulement s'il pointe sur le domaine de l'expéditeur
 * anti-spam —, puis la case « Validé » qui marque le mail comme délivré.
 */
export function AntispamControls({ inboundId, link, validated }: { inboundId: string; link: string | null; validated: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [checked, setChecked] = useState(validated);
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    setChecked(next);
    start(async () => {
      const result = await validateAntispam(inboundId, next);
      if (!result.ok) {
        setChecked(!next);
        return void toast.error(result.error);
      }
      toast.success(next ? "Validation anti-spam notée : mail délivré." : "Validation retirée.");
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 text-[13px] text-warn-ink">
      <span>Le serveur du prospect retient le mail tant que l&apos;expéditeur n&apos;est pas validé.</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1.5 rounded-md border border-warn/45 bg-surface px-2.5 py-1 font-medium motion-safe:transition-colors hover:bg-surface-2"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Ouvrir le lien de validation
        </a>
      ) : (
        <span className="text-faint">Aucun lien sur le domaine de l&apos;expéditeur : validez depuis le mail d&apos;origine.</span>
      )}
      <label className="ml-auto inline-flex cursor-pointer items-center gap-2 font-medium">
        <input
          type="checkbox"
          checked={checked}
          disabled={pending}
          onChange={(event) => toggle(event.target.checked)}
          className="h-4 w-4 accent-[rgb(var(--rgb-warn))]"
        />
        Validé
      </label>
    </div>
  );
}
