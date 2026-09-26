"use client";

import { useEffect, useState } from "react";
import { Filter, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";

/**
 * Réglage « Secteurs exclus », commun aux deux modes de recherche.
 *
 * La liste contient des PRÉFIXES NAF, pas des codes complets : « 8553Z » vise
 * les auto-écoles, « 85 » viserait tout l'enseignement. C'est volontaire — et
 * c'est dit à l'écran, sinon la différence entre les deux se découvre en voyant
 * disparaître la moitié des résultats.
 *
 * Le panneau est replié par défaut : un réglage qu'on touche deux fois par an
 * n'a pas à occuper le haut de l'écran à chaque recherche.
 */

export function ExcludedSectors() {
  const [sectors, setSectors] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/search/settings", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { excludedSectors: string[] };
        if (!cancelled) setSectors(body.excludedSectors);
      } catch {
        // Réglage illisible : on n'affiche pas une liste vide, qui laisserait
        // croire qu'aucun secteur n'est exclu.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: string[]) {
    setSaving(true);
    setError(null);
    const previous = sectors;
    setSectors(next);
    try {
      const response = await fetch("/api/search/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludedSectors: next }),
      });
      if (!response.ok) throw new Error("Enregistrement refusé.");
      const body = (await response.json()) as { excludedSectors: string[] };
      setSectors(body.excludedSectors);
    } catch (cause) {
      // On remet la liste d'avant : afficher un réglage non enregistré ferait
      // croire à une exclusion qui ne s'appliquera pas.
      setSectors(previous);
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (!sectors) return null;

  return (
    <section className="rounded-xl border border-line bg-surface-2/60 px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left text-[13px] font-medium text-muted motion-safe:transition-colors hover:text-text"
        aria-expanded={open}
      >
        <Filter className="h-3.5 w-3.5" aria-hidden />
        Secteurs exclus
        <span className="font-data text-[12px] text-faint">
          {sectors.length} {sectors.length > 1 ? "codes" : "code"}
        </span>
        <span className="ml-auto text-[12px] text-faint">{open ? "masquer" : "modifier"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[12px] leading-snug text-muted">
            Ces codes NAF sont écartés des <strong className="font-medium text-text">deux modes</strong>{" "}
            de recherche. Un préfixe suffit :{" "}
            <span className="font-data">8553Z</span> ne vise que les auto-écoles,{" "}
            <span className="font-data">85</span> viserait tout l&apos;enseignement.
          </p>

          <ul className="flex flex-wrap gap-1.5">
            {sectors.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(sectors.filter((entry) => entry !== code))}
                  title={`Retirer ${code}`}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 font-data text-[11px] text-muted motion-safe:transition-colors hover:border-lost/25 hover:text-lost-ink"
                >
                  {code}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
            {sectors.length === 0 && (
              <li className="text-[12px] text-faint">Aucun secteur exclu.</li>
            )}
          </ul>

          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const code = draft.trim();
              if (!code) return;
              setDraft("");
              void save([...sectors, code]);
            }}
          >
            <div>
              <Label htmlFor="naf-exclu">Ajouter un code</Label>
              <Input
                id="naf-exclu"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="ex : 56.10A"
                className="w-40 font-data"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" loading={saving}>
              Ajouter
            </Button>
          </form>

          {error && (
            <p role="alert" className="text-[12px] text-lost-ink">
              {error}
            </p>
          )}

          <p className="text-[12px] leading-snug text-faint">
            Sont aussi écartés d&apos;office, sans réglage : associations, fondations, syndicats,
            organismes publics et collectivités, et entreprises individuelles sans salarié. Cochez
            « Inclure les exclus » pour les voir le temps d&apos;une recherche.
          </p>
        </div>
      )}
    </section>
  );
}
