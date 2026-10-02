"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { offerUndo } from "@/lib/trash/undo";
import { nextTodo } from "@/lib/today/group";
import type { TodayItem, TodayStatus } from "@/lib/today/types";
import { DISCARD_REASON_LABELS, type DiscardReason } from "@/types";
import { discardToday, saveTodayDraft, undoDiscardToday, validateToday } from "../actions";

/**
 * État de l'écran : sélection, retouches en cours, statuts optimistes.
 *
 * Les statuts changent tout de suite à l'écran (la file avance sans attendre
 * le serveur) ; un refus du serveur les remet en place et le dit.
 */

export interface Draft {
  subject: string;
  core: string;
}

export function useTodayState(initial: TodayItem[], initialKey: string | null = null) {
  const router = useRouter();
  const toast = useToast();
  const [statuses, setStatuses] = useState<Record<string, TodayStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(() => {
    const asked = initialKey ? initial.findIndex((item) => item.key === initialKey) : -1;
    return asked >= 0 ? asked : Math.max(0, initial.findIndex((item) => item.status === "todo"));
  });

  const items = useMemo(
    () => initial.map((item) => ({ ...item, status: statuses[item.key] ?? item.status })),
    [initial, statuses],
  );
  const current = items[Math.min(index, items.length - 1)] ?? null;
  const draftOf = useCallback(
    (item: TodayItem): Draft => drafts[item.key] ?? { subject: item.subject, core: item.body },
    [drafts],
  );

  const setStatus = (key: string, status: TodayStatus) => setStatuses((all) => ({ ...all, [key]: status }));
  const edit = (item: TodayItem, patch: Partial<Draft>) =>
    setDrafts((all) => ({ ...all, [item.key]: { ...draftOf(item), ...patch } }));
  const editOf = (item: TodayItem) => ({ messageId: item.messageId!, ...draftOf(item), optOut: item.optOut, signature: item.signature });

  const advance = (from: number) => setIndex(nextTodo(items.map((item, position) => (position === from ? { status: "valide" as TodayStatus } : item)), from));
  const move = (delta: number) => setIndex((position) => Math.max(0, Math.min(items.length - 1, position + delta)));

  async function save(item: TodayItem) {
    if (!item.messageId || !drafts[item.key]) return;
    const result = await saveTodayDraft(editOf(item));
    if (!result.ok) toast.error(result.error);
  }

  async function validate(item: TodayItem, on = true) {
    if (!item.messageId) return;
    const before = item.status;
    setStatus(item.key, on ? "valide" : "todo");
    if (on) advance(items.indexOf(item));
    const result = await validateToday(editOf(item), on);
    if (!result.ok) {
      setStatus(item.key, before);
      toast.error(result.error);
    }
  }

  async function discard(item: TodayItem, reason: DiscardReason) {
    const before = item.status;
    setStatus(item.key, "ecarte");
    advance(items.indexOf(item));
    const result = await discardToday({
      kind: item.kind,
      reason,
      prospectId: item.prospectId,
      messageId: item.messageId,
      inboundId: item.inboundId,
      candidateId: item.candidateId,
    });
    if (!result.ok) {
      setStatus(item.key, before);
      toast.error(result.error);
      return;
    }
    offerUndo(`${item.companyName} écarté · ${DISCARD_REASON_LABELS[reason]}`, async () => {
      const undone = await undoDiscardToday(result.discardId);
      if (undone.ok) setStatus(item.key, before);
      else toast.error(undone.error);
      router.refresh();
    });
  }

  async function validateChecked() {
    for (const item of items.filter((entry) => checked.has(entry.key) && entry.status === "todo" && entry.messageId)) {
      await validate(item);
    }
    setChecked(new Set());
  }

  const toggle = (key: string) =>
    setChecked((all) => {
      const next = new Set(all);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return { items, index, setIndex, current, draftOf, edit, save, validate, discard, move, checked, toggle, validateChecked, refresh: () => router.refresh() };
}

export type TodayState = ReturnType<typeof useTodayState>;
