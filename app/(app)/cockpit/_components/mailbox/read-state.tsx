"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { markInboundRead } from "@/lib/outbox/actions";
import type { InboxEntry } from "../../_lib/types";

/**
 * « Lu / non lu » côté écran, OPTIMISTE.
 *
 * Le compteur doit bouger à l'instant du clic, sans attendre l'aller-retour :
 * on garde ici les décisions locales et on les applique au compteur rendu par
 * le serveur. Un échec les annule et le dit.
 *
 * Le compteur ne suit pas la même règle que le point de la liste : le point dit
 * la vérité (ce mail n'a pas été ouvert), le compteur ne retient que ce qui
 * demande une action — ni absence, ni anti-spam déjà validé (lib/inbound/read-state).
 */

type Entry = Pick<InboxEntry, "id" | "unread" | "autoKind" | "validated">;

interface ReadStateValue {
  unreadCount: number;
  isUnread: (id: string, fallback: boolean) => boolean;
  setRead: (id: string, read: boolean) => void;
  pendingId: string | null;
}

const ReadStateContext = createContext<ReadStateValue | null>(null);

/** `true` si ce mail pèse dans le compteur quand il n'est pas lu. */
const counted = (entry: Entry): boolean =>
  entry.autoKind !== "absence" && !(entry.autoKind === "antispam" && entry.validated);

export function InboxReadProvider({
  entries,
  initialUnread,
  children,
}: {
  entries: Entry[];
  /** Compteur rendu par le serveur : tous les reçus, pas seulement la page affichée. */
  initialUnread: number;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);

  const unreadCount = useMemo(() => {
    let delta = 0;
    for (const [id, read] of Object.entries(decided)) {
      const entry = byId.get(id);
      if (!entry || !counted(entry)) continue;
      if (read && entry.unread) delta -= 1;
      if (!read && !entry.unread) delta += 1;
    }
    return Math.max(0, initialUnread + delta);
  }, [byId, decided, initialUnread]);

  const isUnread = useCallback(
    (id: string, fallback: boolean) => (id in decided ? !decided[id] : fallback),
    [decided],
  );

  const setRead = useCallback(
    (id: string, read: boolean) => {
      setDecided((current) => (current[id] === read ? current : { ...current, [id]: read }));
      setPendingId(id);
      void markInboundRead(id, read)
        .then((result) => {
          if (result.ok) return void router.refresh();
          // Retour en arrière : l'écran ne doit jamais prétendre un état que la base n'a pas.
          setDecided((current) => {
            const next = { ...current };
            delete next[id];
            return next;
          });
          toast.error(result.error);
        })
        .finally(() => setPendingId((current) => (current === id ? null : current)));
    },
    [router, toast],
  );

  const value = useMemo<ReadStateValue>(
    () => ({ unreadCount, isUnread, setRead, pendingId }),
    [unreadCount, isUnread, setRead, pendingId],
  );

  return <ReadStateContext.Provider value={value}>{children}</ReadStateContext.Provider>;
}

/** `null` hors d'un `InboxReadProvider` : l'appelant retombe sur sa valeur serveur. */
export const useInboxRead = (): ReadStateValue | null => useContext(ReadStateContext);
