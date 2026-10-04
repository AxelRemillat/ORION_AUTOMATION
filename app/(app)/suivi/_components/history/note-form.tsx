"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import { Button, Textarea, useToast } from "@/components/ui";
import { addProspectNote } from "../../history-actions";

/** « Ajouter une note » : texte libre, horodaté, rangé dans l'historique. */
export function NoteForm({ prospectId }: { prospectId: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function save() {
    const value = text.trim();
    if (!value) return;
    start(async () => {
      const result = await addProspectNote(prospectId, value);
      if (!result.ok) return void toast.error(result.error);
      setText("");
      toast.success("Note ajoutée à l'historique.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <Textarea
        aria-label="Ajouter une note"
        placeholder="Ajouter une note (appel, rendez-vous, contexte…)"
        rows={2}
        maxLength={2000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-[44px] flex-1"
      />
      <Button size="sm" variant="secondary" onClick={save} loading={pending} disabled={!text.trim()}>
        <StickyNote className="h-3.5 w-3.5" aria-hidden />
        Ajouter
      </Button>
    </div>
  );
}
