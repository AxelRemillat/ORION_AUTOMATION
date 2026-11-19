"use client";

/**
 * Écran CRM (Cowork #117) : recherche instantanée, filtres étape / métier / ville, bascule tableau ↔ kanban (retenue
 * par le navigateur), création rapide. Tout se filtre côté client : la liste entière est déjà là (quelques centaines
 * de fiches au plus), la recherche répond à chaque frappe sans aller-retour.
 */
import { useEffect, useMemo, useState } from "react";
import { Columns3, List, Plus, Search } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { filtrerCommerces, valeursDistinctes } from "@/lib/crm/logique";
import { ETAPES, type Commerce } from "@/lib/crm/types";
import { useDeplacer } from "./deplacer";
import { FormulaireRapide } from "./formulaire-rapide";
import { KanbanCommerces } from "./kanban";
import { TableauCommerces } from "./tableau";

type Vue = "tableau" | "kanban";
const CLE_VUE = "orion:crm:vue";

export function CrmClient({ commerces, aujourdhui, nouveauOuvert = false }: { commerces: Commerce[]; aujourdhui: string; nouveauOuvert?: boolean }) {
  const [q, setQ] = useState("");
  const [etape, setEtape] = useState("");
  const [metier, setMetier] = useState("");
  const [ville, setVille] = useState("");
  const [vue, setVue] = useState<Vue>("tableau");
  const [nouveau, setNouveau] = useState(nouveauOuvert);
  const { deplacer, fenetre } = useDeplacer();

  useEffect(() => {
    try {
      const v = localStorage.getItem(CLE_VUE);
      if (v === "kanban" || v === "tableau") setVue(v);
    } catch {
      /* stockage indisponible : vue par défaut */
    }
  }, []);
  const choisirVue = (v: Vue) => {
    setVue(v);
    try {
      localStorage.setItem(CLE_VUE, v);
    } catch {
      /* rien */
    }
  };

  const metiers = useMemo(() => valeursDistinctes(commerces, "metier"), [commerces]);
  const villes = useMemo(() => valeursDistinctes(commerces, "ville"), [commerces]);
  // Le kanban montre toutes les étapes : le filtre d'étape ne s'applique qu'au tableau.
  const visibles = useMemo(() => filtrerCommerces(commerces, { q, metier, ville, etape: vue === "tableau" ? etape : "" }), [commerces, q, metier, ville, etape, vue]);
  const filtres = Boolean(q || metier || ville || (vue === "tableau" && etape));

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <label className="relative block">
          <span className="sr-only">Rechercher une fiche</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, ville, métier, téléphone…" className="pl-9" autoComplete="off" />
        </label>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Affichage" className="flex rounded-xl border border-line bg-surface p-0.5">
            {(["tableau", "kanban"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={vue === v}
                onClick={() => choisirVue(v)}
                className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors ${vue === v ? "bg-primary/15 text-primary-ink" : "text-muted hover:text-text"}`}
              >
                {v === "tableau" ? <List className="size-4" aria-hidden /> : <Columns3 className="size-4" aria-hidden />}
                {v === "tableau" ? "Tableau" : "Kanban"}
              </button>
            ))}
          </div>
          <Button onClick={() => setNouveau(true)} className="ml-auto sm:ml-0">
            <Plus className="size-4" aria-hidden />
            Nouvelle fiche
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {vue === "tableau" && (
          <div className="sm:w-44">
            <Select aria-label="Filtrer par étape" value={etape} onChange={(e) => setEtape(e.target.value)} className="h-9 text-sm">
              <option value="">Toutes les étapes</option>
              {ETAPES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.libelle}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="sm:w-44">
          <Select aria-label="Filtrer par métier" value={metier} onChange={(e) => setMetier(e.target.value)} className="h-9 text-sm">
            <option value="">Tous les métiers</option>
            {metiers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:w-44">
          <Select aria-label="Filtrer par ville" value={ville} onChange={(e) => setVille(e.target.value)} className="h-9 text-sm">
            <option value="">Toutes les villes</option>
            {villes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <p className="col-span-2 text-xs text-muted sm:ml-auto" aria-live="polite">
          <span className="font-data">{visibles.length}</span> fiche{visibles.length > 1 ? "s" : ""}
          {filtres && (
            <button
              type="button"
              className="ml-2 text-primary-ink underline-offset-4 hover:underline"
              onClick={() => {
                setQ("");
                setEtape("");
                setMetier("");
                setVille("");
              }}
            >
              Effacer les filtres
            </button>
          )}
        </p>
      </div>

      {vue === "tableau" ? (
        <TableauCommerces commerces={visibles} aujourdhui={aujourdhui} deplacer={deplacer} />
      ) : (
        <KanbanCommerces commerces={visibles} aujourdhui={aujourdhui} deplacer={deplacer} />
      )}

      <FormulaireRapide ouvert={nouveau} onFermer={() => setNouveau(false)} />
      {fenetre}
    </div>
  );
}
