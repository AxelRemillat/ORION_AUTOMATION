"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark, BookmarkPlus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { NAF_SECTIONS, SIZE_BUCKETS } from "@/lib/enrichment/naf";
import type { SearchCriteriaInput } from "./search-form";

export interface SavedSearch {
  id: string;
  label: string;
  criteria: SearchCriteriaInput;
}

/**
 * Persistance volontairement simple : les recherches sauvegardées sont locales
 * au navigateur (pas de table dédiée côté Supabase). Toute lecture/écriture est
 * protégée — navigation privée ou stockage bloqué ne doit rien casser.
 */
const STORAGE_KEY = "orion.saved-searches";
const MAX_SAVED = 8;

function read(): SavedSearch[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedSearch[]) : [];
  } catch {
    return [];
  }
}

function write(items: SavedSearch[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Stockage indisponible : la session reste utilisable, sans persistance.
  }
}

/** Résume des critères en une étiquette lisible. */
export function describeCriteria(criteria: SearchCriteriaInput): string {
  const parts = [
    NAF_SECTIONS.find((section) => section.code === criteria.section)?.label,
    SIZE_BUCKETS.find((bucket) => bucket.id === criteria.size)?.label,
    criteria.zone.trim() || null,
    criteria.q.trim() || null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Tous critères";
}

export function SavedSearches({
  current,
  canSave,
  onApply,
}: {
  /** Critères de la dernière recherche lancée, ou null si aucune. */
  current: SearchCriteriaInput | null;
  canSave: boolean;
  onApply: (criteria: SearchCriteriaInput) => void;
}) {
  const [items, setItems] = useState<SavedSearch[]>([]);

  // localStorage n'existe pas au rendu serveur : on charge après montage.
  useEffect(() => setItems(read()), []);

  const persist = useCallback((next: SavedSearch[]) => {
    setItems(next);
    write(next);
  }, []);

  function save() {
    if (!current) return;
    const label = describeCriteria(current);
    if (items.some((item) => item.label === label)) return;
    persist([{ id: `${Date.now()}`, label, criteria: current }, ...items].slice(0, MAX_SAVED));
  }

  const remove = (id: string) => persist(items.filter((item) => item.id !== id));

  if (!items.length && !canSave) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--muted)" }}
      >
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
        Recherches
      </span>

      {items.map((item) => (
        <span
          key={item.id}
          className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[12px]"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface-2)",
            color: "var(--text)",
          }}
        >
          <button
            type="button"
            onClick={() => onApply(item.criteria)}
            className="rounded-full outline-none"
            title="Relancer cette recherche"
          >
            {item.label}
          </button>
          <button
            type="button"
            onClick={() => remove(item.id)}
            aria-label={`Supprimer la recherche ${item.label}`}
            className="rounded-full p-0.5"
            style={{ color: "var(--faint)" }}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}

      {canSave && (
        <Button size="sm" variant="ghost" onClick={save} disabled={!current}>
          <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
          Sauvegarder
        </Button>
      )}

      {!items.length && (
        <span className="text-[12px]" style={{ color: "var(--faint)" }}>
          Sauvegardées dans ce navigateur uniquement.
        </span>
      )}
    </div>
  );
}
