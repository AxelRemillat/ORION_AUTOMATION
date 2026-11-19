"use client";

/**
 * Vue tableau du CRM (Cowork #117). Téléphone : une carte par fiche (nom, métier · ville, étape, prochaine action).
 * Dès 768 px : un vrai tableau. L'étape se change sur place (liste déroulante), sans ouvrir la fiche.
 */
import Link from "next/link";
import { Badge, Select, Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ETAPES, libelleCanal, libelleEtape, type Commerce } from "@/lib/crm/types";
import { CLASSE_URGENCE, echeance, TON_ETAPE } from "./outils";

interface Props {
  commerces: Commerce[];
  aujourdhui: string;
  deplacer: (id: string, nom: string, etape: string) => void;
}

function Action({ c, aujourdhui }: { c: Commerce; aujourdhui: string }) {
  const e = echeance(c.prochaine_action_le, aujourdhui);
  if (!c.prochaine_action && !e) return <span className="text-faint">—</span>;
  return (
    <span className="min-w-0">
      {e && <span className={`font-data text-xs ${CLASSE_URGENCE[e.urgence]}`}>{e.texte}</span>}
      {e && c.prochaine_action && <span className="text-faint"> · </span>}
      {c.prochaine_action && <span className="text-sm text-text">{c.prochaine_action}</span>}
    </span>
  );
}

function ChoixEtape({ c, deplacer }: { c: Commerce; deplacer: Props["deplacer"] }) {
  return (
    <Select aria-label={`Étape de ${c.nom}`} value={c.etape} onChange={(e) => deplacer(c.id, c.nom, e.target.value)} className="h-9 min-w-[9.5rem] text-sm">
      {ETAPES.map((e) => (
        <option key={e.id} value={e.id}>
          {e.libelle}
        </option>
      ))}
    </Select>
  );
}

export function TableauCommerces({ commerces, aujourdhui, deplacer }: Props) {
  return (
    <>
      {/* Téléphone : cartes */}
      <ul className="grid gap-2 md:hidden" aria-label="Fiches du CRM">
        {commerces.length === 0 && <li className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">Aucune fiche ne correspond.</li>}
        {commerces.map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-surface p-3 shadow-mist">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/crm/${c.id}`} className="min-w-0 flex-1 py-1">
                <span className="block truncate font-display text-base text-text">{c.nom}</span>
                <span className="block truncate text-xs text-muted">{[c.metier, c.ville].filter(Boolean).join(" · ") || "—"}</span>
              </Link>
              <Badge tone={TON_ETAPE[c.etape]}>{libelleEtape(c.etape)}</Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Action c={c} aujourdhui={aujourdhui} />
              <ChoixEtape c={c} deplacer={deplacer} />
            </div>
          </li>
        ))}
      </ul>

      {/* Ordinateur : tableau */}
      <div className="hidden md:block">
        <Table>
          <THead>
            <TR>
              <TH>Commerce</TH>
              <TH>Ville</TH>
              <TH>Étape</TH>
              <TH>Prochaine action</TH>
              <TH>Canal</TH>
            </TR>
          </THead>
          <TBody>
            {commerces.length === 0 && <TableEmpty colSpan={5}>Aucune fiche ne correspond.</TableEmpty>}
            {commerces.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link href={`/crm/${c.id}`} className="font-medium text-text hover:text-primary-ink">
                    {c.nom}
                  </Link>
                  {c.metier && <span className="block text-xs text-muted">{c.metier}</span>}
                </TD>
                <TD className="text-muted">{c.ville ?? "—"}</TD>
                <TD>
                  <ChoixEtape c={c} deplacer={deplacer} />
                </TD>
                <TD>
                  <Action c={c} aujourdhui={aujourdhui} />
                </TD>
                <TD className="text-xs text-muted">{libelleCanal(c.canal)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}
