"use client";

/**
 * Vue kanban du CRM (Cowork #117) : une colonne par étape, dans l'ordre du pipeline. Ordinateur : on glisse une
 * carte d'une colonne à l'autre. Téléphone (et clavier) : chaque carte a son menu « Déplacer vers… ». Les colonnes
 * défilent de côté sur mobile, aimantées.
 */
import Link from "next/link";
import { useState } from "react";
import { parEtape } from "@/lib/crm/logique";
import { ETAPES, type Commerce } from "@/lib/crm/types";
import { CLASSE_URGENCE, echeance, euros } from "./outils";

interface Props {
  commerces: Commerce[];
  aujourdhui: string;
  deplacer: (id: string, nom: string, etape: string) => void;
}

export function KanbanCommerces({ commerces, aujourdhui, deplacer }: Props) {
  const colonnes = parEtape(commerces, ETAPES);
  const [survol, setSurvol] = useState<string | null>(null);

  return (
    <div className="relative -mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin sm:mx-0 sm:px-0" role="region" aria-label="Pipeline en colonnes">
      <ol className="flex snap-x snap-mandatory gap-3">
        {ETAPES.map((etape) => {
          const liste = colonnes[etape.id] ?? [];
          return (
            <li
              key={etape.id}
              aria-label={`${etape.libelle} : ${liste.length} fiche${liste.length > 1 ? "s" : ""}`}
              className={`flex w-[78vw] max-w-[18rem] shrink-0 snap-start flex-col rounded-2xl border bg-surface-2/60 p-2 transition-colors sm:w-64 ${survol === etape.id ? "border-primary/40 bg-primary/10" : "border-line"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setSurvol(etape.id);
              }}
              onDragLeave={() => setSurvol((s) => (s === etape.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setSurvol(null);
                const [id, nom] = e.dataTransfer.getData("text/plain").split("\u0000");
                if (id) deplacer(id, nom, etape.id);
              }}
            >
              <h2 className="flex items-center justify-between px-1 pb-2 pt-1 font-display text-sm text-text">
                {etape.libelle}
                <span className="rounded-full bg-surface px-2 font-data text-xs text-muted">{liste.length}</span>
              </h2>
              <ul className="grid gap-2">
                {liste.map((c) => {
                  const e = echeance(c.prochaine_action_le, aujourdhui);
                  return (
                    <li
                      key={c.id}
                      draggable
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", `${c.id}\u0000${c.nom}`)}
                      className="cursor-grab rounded-xl border border-line bg-surface p-3 shadow-mist active:cursor-grabbing"
                    >
                      <Link href={`/crm/${c.id}`} className="block font-medium leading-snug text-text hover:text-primary-ink">
                        {c.nom}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted">{[c.metier, c.ville].filter(Boolean).join(" · ") || "—"}</p>
                      {(c.prochaine_action || e) && (
                        <p className="mt-2 text-xs">
                          {e && <span className={`font-data ${CLASSE_URGENCE[e.urgence]}`}>{e.texte}</span>}
                          {e && c.prochaine_action && <span className="text-faint"> · </span>}
                          <span className="text-text">{c.prochaine_action}</span>
                        </p>
                      )}
                      {c.montant_devis !== null && <p className="mt-1 font-data text-xs text-muted">{euros(c.montant_devis)}</p>}
                      {c.etape === "perdu" && c.motif_perte && <p className="mt-1 text-xs text-lost-ink">{c.motif_perte}</p>}
                      <label className="mt-2 block">
                        <span className="sr-only">Déplacer {c.nom} vers</span>
                        <select
                          value=""
                          onChange={(ev) => ev.target.value && deplacer(c.id, c.nom, ev.target.value)}
                          className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-xs text-muted"
                        >
                          <option value="">Déplacer vers…</option>
                          {ETAPES.filter((x) => x.id !== c.etape).map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.libelle}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
                {liste.length === 0 && <li className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-faint">Vide</li>}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
