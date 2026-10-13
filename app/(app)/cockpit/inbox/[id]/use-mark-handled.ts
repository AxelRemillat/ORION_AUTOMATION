"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** Clôt l'entrant sans répondre — utile pour un refus ou un message traité ailleurs. */
export function useMarkHandled(inboundId: string) {
  const router = useRouter();
  const toast = useToast();
  const [marking, setMarking] = useState(false);
  async function markHandled() {
    setMarking(true);
    // Traité à la main : c'est aussi lu (le badge « non lus » ne doit pas le garder).
    const { error } = await createClient()
      .from("inbound_messages")
      .update({ handled: true, read_at: new Date().toISOString() })
      .eq("id", inboundId);
    if (error) {
      toast.error(error.message);
      return setMarking(false);
    }
    toast.success("Message classé comme traité.");
    router.push("/cockpit");
    router.refresh();
  }
  return { marking, markHandled };
}
