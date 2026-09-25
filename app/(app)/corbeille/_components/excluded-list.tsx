"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw } from "lucide-react";
import { Button, Card, EmptyState, useToast } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import type { ExcludedCompany } from "@/types";
import { allowSirenAgain } from "../actions";

/** SIREN que la recherche ne propose plus, avec « Autoriser à nouveau ». */
export function ExcludedList({ exclusions }: { exclusions: ExcludedCompany[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  if (!exclusions.length) {
    return (
      <EmptyState
        icon={<Ban />}
        title="Aucune entreprise exclue"
        description="Un prospect supprimé définitivement entre ici : la recherche ne le reproposera plus."
      />
    );
  }

  function allow(siren: string) {
    startTransition(async () => {
      const result = await allowSirenAgain(siren);
      if (result.ok) toast.success(`SIREN ${siren} à nouveau proposé par la recherche.`);
      else toast.error(result.error);
      router.refresh();
    });
  }

  return (
    <Card className="divide-y divide-line-soft">
      {exclusions.map((item) => (
        <div key={item.siren} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="font-data text-[14px] text-text">SIREN {item.siren}</p>
            <p className="mt-0.5 text-[12px] text-faint">
              Exclu le {formatDate(item.created_at)}
              {item.reason ? ` · ${item.reason}` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" loading={pending} onClick={() => allow(item.siren)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Autoriser à nouveau
          </Button>
        </div>
      ))}
    </Card>
  );
}
