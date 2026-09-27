"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { OutboxItem } from "@/lib/outbox/feed";

const POLL_MS = 30_000;

/**
 * Envois programmés, sur toutes les pages : badge du nombre d'envois à venir
 * (rouge s'il y a un échec à reprendre), et toast dès qu'un envoi programmé est
 * parti ou a échoué — y compris pendant que l'app était fermée.
 */
export function OutboxIndicator() {
  const toast = useToast();
  const router = useRouter();
  const [upcoming, setUpcoming] = useState<OutboxItem[]>([]);
  const announced = useRef(new Set<string>());

  const poll = useCallback(async () => {
    if (document.hidden) return;
    try {
      const response = await fetch("/api/outbox", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { upcoming: OutboxItem[]; results: OutboxItem[] };
      setUpcoming(body.upcoming);
      const fresh = body.results.filter((item) => !announced.current.has(item.id));
      if (!fresh.length) return;
      for (const item of fresh) {
        announced.current.add(item.id);
        if (item.sendStatus === "sent") toast.success(`Envoi programmé parti : ${item.companyName}.`);
        else toast.error(`Envoi programmé échoué — ${item.companyName} : ${item.sendError ?? "raison inconnue"}`);
      }
      await fetch("/api/outbox/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: fresh.map((item) => item.id) }),
      });
      // Statuts, relances et badges ont bougé côté serveur.
      router.refresh();
    } catch {
      // Réseau coupé : le prochain tour réessaiera.
    }
  }, [toast, router]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => !document.hidden && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  if (!upcoming.length) return null;
  const failed = upcoming.filter((item) => item.sendStatus === "failed").length;
  const label = failed
    ? `${failed} envoi(s) programmé(s) en échec`
    : `${upcoming.length} envoi(s) programmé(s)`;

  return (
    <Link
      href="/cockpit#envois-programmes"
      aria-label={label}
      title={label}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      <CalendarClock className="h-4 w-4" aria-hidden />
      <span
        className={cn(
          "font-data absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full px-1 text-center text-[10px] leading-4 ring-1",
          failed ? "bg-lost/15 text-lost-ink ring-lost/40" : "bg-primary/15 text-primary-ink ring-primary/30",
        )}
      >
        {failed || upcoming.length}
      </span>
    </Link>
  );
}
