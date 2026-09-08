"use client";

import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";

/** Mode B — saisie libre : nom d'entreprise, SIREN ou URL, puis même enrichissement. */
export function ManualForm({
  onSubmit,
  loading,
}: {
  onSubmit: (query: string) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) onSubmit(query.trim());
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="saisie">Nom d&apos;entreprise, SIREN ou site web</Label>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[240px] flex-1">
            <Input
              id="saisie"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Acme SAS · 552100554 · acme.fr"
            />
          </div>
          <Button type="submit" loading={loading} disabled={!query.trim()}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Enrichir
          </Button>
        </div>
      </div>
      <p className="text-[13px] text-muted">
        L&apos;entreprise est d&apos;abord identifiée dans l&apos;annuaire public, puis enrichie avec
        ses données financières et ses signaux web.
      </p>
    </form>
  );
}
