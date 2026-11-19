"use client";

/**
 * Une tâche d'« Aujourd'hui » (Cowork #117) : la fiche, l'action prévue, son retard, l'appel en un geste, et « Fait »
 * qui note l'action dans la chronologie et propose la suivante (texte + date), sans quitter l'écran.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Phone } from "lucide-react";
import { Badge, Button, Input, useToast } from "@/components/ui";
import { terminerAction } from "@/app/(app)/crm/actions";
import { libelleEtape, type Commerce } from "@/lib/crm/types";
import { CLASSE_URGENCE, echeance, TON_ETAPE } from "./outils";

export function TacheCarte({ c, aujourdhui }: { c: Commerce; aujourdhui: string }) {
  const router = useRouter();
  const toast = useToast();
  const [ouvert, setOuvert] = useState(false);
  const [suite, setSuite] = useState({ texte: "", le: "" });
  const [enCours, demarrer] = useTransition();
  const e = echeance(c.prochaine_action_le, aujourdhui);

  const valider = () =>
    demarrer(async () => {
      const r = await terminerAction(c.id, { prochaineAction: suite.texte, prochaineActionLe: suite.le });
      if (!r.ok) return toast.error(r.error);
      toast.success(`${c.nom} : action notée`);
      setOuvert(false);
      router.refresh();
    });

  return (
    <li className="rounded-xl border border-line bg-surface p-3 shadow-mist">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/crm/${c.id}`} className="font-medium text-text hover:underline">
              {c.nom}
            </Link>
            <Badge tone={TON_ETAPE[c.etape]}>{libelleEtape(c.etape)}</Badge>
          </p>
          <p className="mt-0.5 text-xs text-muted">{[c.metier, c.ville, c.contact_prenom].filter(Boolean).join(" · ")}</p>
          <p className="mt-2 text-sm text-text">
            {e && <span className={`font-data ${CLASSE_URGENCE[e.urgence]}`}>{e.texte} · </span>}
            {c.prochaine_action ?? "Action à préciser"}
          </p>
        </div>
        {c.telephone && (
          <a
            href={`tel:${c.telephone.replace(/[^\d+]/g, "")}`}
            aria-label={`Appeler ${c.nom}`}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line text-primary-ink hover:border-primary/40"
          >
            <Phone className="size-4" aria-hidden />
          </a>
        )}
      </div>
      {!ouvert ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOuvert(true)}>
          <Check className="size-4" aria-hidden />
          Fait
        </Button>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
          <Input value={suite.texte} onChange={(ev) => setSuite({ ...suite, texte: ev.target.value })} placeholder="Action suivante (facultatif)" aria-label={`Action suivante pour ${c.nom}`} />
          <Input type="date" value={suite.le} onChange={(ev) => setSuite({ ...suite, le: ev.target.value })} aria-label={`Date de l'action suivante pour ${c.nom}`} />
          <Button size="sm" onClick={valider} loading={enCours}>
            Valider
          </Button>
        </div>
      )}
    </li>
  );
}
