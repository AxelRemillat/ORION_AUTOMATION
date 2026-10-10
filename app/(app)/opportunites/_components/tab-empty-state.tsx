import { Briefcase } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import type { PlatformTab } from "@/lib/opportunities/tabs";

/** Upwork : le circuit, en trois lignes (pas de flux d'annonces, Upwork bloque la lecture). */
const UPWORK_STEPS = [
  "Copiez l'annonce sur Upwork, puis collez-la dans le formulaire ci-dessus.",
  "La proposition en anglais est prête en une trentaine de secondes : « Copier », collez-la sur Upwork, puis « Marquer envoyée ».",
  "Les invitations et messages Upwork arrivent ici tout seuls, par e-mail.",
];

/** État vide utile, propre à chaque plateforme. */
export function TabEmptyState({ tab, onPaste }: { tab: PlatformTab; onPaste: () => void }) {
  if (tab === "upwork") {
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="mb-2 text-[14px] font-medium text-text">Aucune fiche Upwork pour l&apos;instant</p>
        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
          {UPWORK_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    );
  }
  const copy =
    tab === "comeup"
      ? {
          title: "Aucune commande ComeUp",
          description:
            "ComeUp fonctionne avec les services que vous y publiez : les commandes, demandes personnalisées et messages arrivent ici automatiquement, par e-mail. Une demande reçue autrement se colle à la main.",
          action: "Coller une demande",
        }
      : tab === "codeur"
        ? { title: "Aucune annonce Codeur", description: "La veille Codeur les ajoute toute seule ; vous pouvez aussi coller une annonce.", action: "Coller une annonce" }
        : { title: "Aucune fiche", description: "Les e-mails Malt et des autres plateformes arrivent ici tout seuls.", action: "Coller une annonce" };
  return <EmptyState icon={<Briefcase className="h-6 w-6" aria-hidden />} title={copy.title} description={copy.description} action={<Button onClick={onPaste}>{copy.action}</Button>} />;
}
