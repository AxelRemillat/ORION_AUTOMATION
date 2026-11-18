import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { readPrefs } from "@/lib/funnel/settings";
import { lastPrepareHealth, livePrepareJob, prepareAlert } from "@/lib/today/auto-run";
import { loadCapacity } from "@/lib/today/capacity";
import { flatten } from "@/lib/today/group";
import { cachedOpenAiBudget } from "@/lib/today/openai-gate";
import { loadToday } from "@/lib/today/load";
import { loadYieldPlan } from "@/lib/today/yield";
import { TodayClient } from "./_components/today-client";
import { prospectionEmailActive } from "@/lib/prospection/pause";

export const dynamic = "force-dynamic";
export const metadata = { title: "Archives · Prospection e-mail" };

/**
 * ARCHIVES › PROSPECTION E-MAIL (refonte CRM, Cowork #117, 18/11/2026) : l'ancien écran « Aujourd'hui » des mails,
 * déplacé tel quel et en LECTURE SEULE tant que la prospection par e-mail est en pause (actions refusées dans
 * ./actions.ts). Rien n'est supprimé : file, brouillons et historique restent en base. « Aujourd'hui » est désormais
 * l'écran des tâches du CRM.
 *
 * Ancien commentaire : « Aujourd'hui » — la page d'accueil. La file est recalculée depuis les tables
 * à chaque ouverture (lib/today/load.ts) : les fiches des runs précédents y
 * figurent d'office, rien n'est recopié.
 */
export default async function AujourdhuiPage({ searchParams }: { searchParams: { item?: string } }) {
  const user = await requireUser();
  const db = createClient();
  const [data, capacity, prefs, liveJobId, health, openai] = await Promise.all([
    loadToday(db, user.id),
    loadCapacity(db, user.id),
    readPrefs(db, user.id),
    livePrepareJob(db, user.id),
    lastPrepareHealth(db, user.id).catch(() => null),
    // Plafond OpenAI : valeur de moins de 5 min (sa lecture complète prenait ≈ 2 s, Cowork #25).
    cachedOpenAiBudget().catch(() => null),
  ]);
  const items = flatten(data.groups);
  // « Céder la place aux relances » : calculé seulement quand le plafond est engagé (lecture seule).
  const yieldPlan = await loadYieldPlan(db, user.id, capacity, items).catch(() => null);
  const enPause = !prospectionEmailActive();
  return (
    <>
      {enPause && (
        <div role="note" className="mb-4 rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn-ink">
          <strong className="font-semibold">Archive en lecture seule.</strong> La prospection par e-mail est en pause depuis le
          18/11/2026 : aucune préparation, rédaction, relance ni envoi. Rien n&apos;est supprimé : la file et l&apos;historique
          restent consultables ici. Les anciens écrans restent ouverts :{" "}
          <Link href="/cockpit" className="underline underline-offset-2">Cockpit</Link>,{" "}
          <Link href="/suivi" className="underline underline-offset-2">Pipeline</Link>,{" "}
          <Link href="/recherche" className="underline underline-offset-2">Recherche avancée</Link>.
        </div>
      )}
    <TodayClient
      today={data.today}
      items={items}
      yieldPlan={yieldPlan}
      capacity={capacity}
      liveJobId={liveJobId}
      alert={liveJobId ? null : prepareAlert(health)}
      blockedReason={openai?.level === "plafond" ? openai.message : null}
      dailyTarget={prefs.dailyTarget}
      initialKey={typeof searchParams.item === "string" ? searchParams.item : null}
    />
    </>
  );
}
