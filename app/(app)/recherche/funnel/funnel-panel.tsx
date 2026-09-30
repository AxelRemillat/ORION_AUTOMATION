"use client";

import { Radar } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { FunnelCard as CardData } from "@/lib/funnel/view";
import { ErrorBanner } from "../banners";
import { FunnelBanner } from "./funnel-banner";
import { FunnelCard } from "./funnel-card";
import { FunnelRejects } from "./funnel-rejects";
import { FunnelSettings } from "./funnel-settings";
import { useFunnel } from "./use-funnel";

/**
 * Onglet « Signaux » — l'entonnoir inversé : on part d'un fait daté et
 * gratuit, on filtre sans rien payer, on trie au LLM bon marché, et on ne
 * creuse (Pappers, contact, brief) que les meilleurs. Le job tourne en tâche
 * de fond : les cartes apparaissent au fil du creusage.
 */

function Section({ title, cards }: { title: string; cards: CardData[] }) {
  if (!cards.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[15px]">
        {title} <span className="font-data text-muted">{cards.length}</span>
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <FunnelCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

export function FunnelSettingsBlock({ funnel }: { funnel: ReturnType<typeof useFunnel> }) {
  return <FunnelSettings onStart={() => void funnel.start()} busy={funnel.starting || funnel.active} />;
}

export function FunnelResults({ funnel }: { funnel: ReturnType<typeof useFunnel> }) {
  const { snapshot, error } = funnel;
  const cards = snapshot?.cards ?? [];
  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorBanner message={error} />}
      {snapshot?.job && <FunnelBanner snapshot={snapshot} />}
      <Section title="Prospects prêts" cards={cards.filter((card) => card.publication === "pret")} />
      {/* Pas d'email mais un téléphone sur le site : on appelle, on ne perd pas la fiche. */}
      <Section title="À appeler (pas d'email, téléphone du site)" cards={cards.filter((card) => card.publication === "a_completer" && card.phone)} />
      <Section title="À compléter (ni email ni téléphone)" cards={cards.filter((card) => card.publication === "a_completer" && !card.phone)} />
      <Section title="Retenus, en attente de creusage" cards={cards.filter((card) => card.statut === "retenu")} />
      {snapshot && !snapshot.job && (
        <EmptyState
          icon={<Radar />}
          title="Aucun run de l'entonnoir"
          description="Indiquez vos départements puis lancez : BODACC et France Travail sont lus gratuitement, seuls les meilleurs signaux sont creusés."
        />
      )}
      <FunnelRejects rejects={snapshot?.rejects ?? []} />
    </div>
  );
}

export { useFunnel };
