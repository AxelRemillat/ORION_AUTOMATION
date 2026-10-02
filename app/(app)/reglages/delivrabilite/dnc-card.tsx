"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserX } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, useToast } from "@/components/ui";
import { addDoNotContact } from "../actions";

/**
 * Liste « ne plus contacter » : lecture, et ajout manuel d'un prospect. Pas de
 * retrait en masse ici (le retrait reste possible fiche par fiche, dans le Suivi).
 */
interface Row {
  id: string;
  name: string;
  city: string | null;
}

export function DncCard({ blocked, candidates }: { blocked: Row[]; candidates: Row[] }) {
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const match = useMemo(() => candidates.find((row) => row.name.toLowerCase() === query.trim().toLowerCase()) ?? null, [candidates, query]);

  function add() {
    if (!match) return;
    start(async () => {
      const result = await addDoNotContact(match.id);
      if (!result.ok) return void toast.error(result.error);
      toast.success(`${match.name} : plus aucun envoi.`);
      setQuery("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX className="h-4 w-4 text-lost-ink" aria-hidden />
          Ne plus contacter <span className="font-data text-[13px] text-muted">{blocked.length}</span>
        </CardTitle>
        <CardDescription>Tout envoi vers ces prospects est refusé par le serveur, programmé ou non.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="dnc-add">Ajouter un prospect</Label>
            <Input id="dnc-add" list="dnc-candidates" placeholder="Nom de l'entreprise" value={query} onChange={(event) => setQuery(event.target.value)} />
            <datalist id="dnc-candidates">
              {candidates.map((row) => (
                <option key={row.id} value={row.name}>
                  {row.city ?? ""}
                </option>
              ))}
            </datalist>
          </div>
          <Button variant="danger" onClick={add} loading={pending} disabled={!match}>
            Ne plus contacter
          </Button>
        </div>
        {blocked.length ? (
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {blocked.map((row) => (
              <li key={row.id} className="flex justify-between gap-3 border-b border-line-soft py-1.5 text-[13px] last:border-0">
                <span className="truncate text-text">{row.name}</span>
                <span className="shrink-0 text-faint">{row.city ?? ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-faint">Aucun prospect dans la liste.</p>
        )}
      </CardContent>
    </Card>
  );
}
