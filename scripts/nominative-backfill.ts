/**
 * RATTRAPAGE des contacts nominatifs (Cowork, 06/10/2026) — en local, contre la
 * base de production (.env.local). Aucun envoi, aucune suppression.
 *
 *   npm run contacts:nominatifs                      → SIMULATION (lecture seule, 0 crédit)
 *   npm run contacts:nominatifs -- --apply           → réel : Hunter + mise à jour des fiches
 *   npm run contacts:nominatifs -- --apply --limit 40 --max-credits 120
 *
 * Cible : fiches NON contactées, avec une adresse GÉNÉRIQUE, dont aucun
 * brouillon n'est validé, programmé ou retouché à la main, jamais opposées ni
 * « ne plus contacter » (lib/contact-finder/upgrade.ts). Une adresse
 * nominative trouvée remplace la générique ; les brouillons libres sont
 * marqués « à régénérer » — la régénération appartient au générateur.
 *
 * Plafonds : `--max-credits` (défaut 150) sur ce run, et le budget du jour
 * HUNTER_DAILY_BUDGET du garde-fou Hunter.
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { upgradeProspectLive } from "@/lib/contact-finder/nominative-live";
import { topicOf } from "@/lib/contact-finder/nominative";
import { addresseeHint, ineligibility, isFreeDraft, isGenericAddress, nominativeShare, type UpgradeProspect } from "@/lib/contact-finder/upgrade";
import { usagePerson } from "@/lib/emails/salutation";
import type { Db } from "@/lib/trash/scope";

const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const APPLY = process.argv.includes("--apply");
const LIMIT = arg("--limit", 60);
const MAX_CREDITS = arg("--max-credits", 150);

type MessageRow = Parameters<typeof isFreeDraft>[0] & { prospect_id: string };

async function hunterCreditsSince(since: string): Promise<number> {
  const rows = await readAll<{ units: number }>(() => db.from("api_usage").select("units").eq("service", "hunter").gte("created_at", since).order("id"));
  return rows.reduce((total, row) => total + (Number(row.units) || 0), 0);
}

async function loadStock(userId: string) {
  const prospects = await readAll<UpgradeProspect>(() => db.from("prospects").select("*").eq("user_id", userId).is("deleted_at", null).order("id"));
  const messages = await readAll<MessageRow>(() =>
    db.from("messages").select("id, prospect_id, type, status, send_status, validated_at, edited_by_hand, scheduled_at, deleted_at").eq("user_id", userId).order("id"),
  );
  const byProspect = new Map<string, MessageRow[]>();
  for (const row of messages) if (!row.deleted_at && row.type !== "note") byProspect.set(row.prospect_id, [...(byProspect.get(row.prospect_id) ?? []), row]);
  // Le STOCK : fiches avec une adresse, pas encore contactées.
  const stock = prospects.filter((prospect) => prospect.email && !(byProspect.get(prospect.id) ?? []).some((row) => row.status === "sent"));
  return { stock, byProspect };
}

const pct = (share: { nominative: number; total: number }) => (share.total ? `${Math.round((share.nominative / share.total) * 100)} % (${share.nominative}/${share.total})` : "—");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const { stock, byProspect } = await loadStock(userId);
  const before = nominativeShare(stock);

  const reasons = new Map<string, number>();
  const candidates = stock.filter((prospect) => {
    if (!isGenericAddress(prospect)) return false;
    const refused = ineligibility(prospect) ?? ((byProspect.get(prospect.id) ?? []).every(isFreeDraft) ? null : "brouillon validé, programmé ou modifié à la main");
    if (refused) reasons.set(refused, (reasons.get(refused) ?? 0) + 1);
    return !refused;
  });

  console.log(`Stock (adresse connue, non contacté) : ${stock.length} fiche(s) — nominatif ${pct(before)}`);
  console.log(`Génériques éligibles au rattrapage : ${candidates.length}`);
  for (const [reason, count] of reasons) console.log(`  écartées — ${reason} : ${count}`);

  if (!APPLY) {
    console.log(`\nSIMULATION (aucun appel Hunter, aucune écriture). Au plus ~${Math.min(candidates.length, LIMIT) * 3} crédits Hunter pour ${Math.min(candidates.length, LIMIT)} fiche(s).`);
    for (const prospect of candidates.slice(0, 20)) console.log(`  · ${prospect.company_name} <${prospect.email}> — sujet : ${topicOf(prospect.brief?.pain?.task ?? prospect.pain_point)}`);
    console.log("\nRelancer avec --apply pour exécuter.");
    return;
  }

  const examples: { company: string; role: string; topic: string; pain: string }[] = [];
  const misses: string[] = [];
  let upgraded = 0;
  let flagged = 0;
  for (const prospect of candidates.slice(0, LIMIT)) {
    if ((await hunterCreditsSince(started)) >= MAX_CREDITS) {
      console.log(`arrêt : plafond du run atteint (${MAX_CREDITS} crédits)`);
      break;
    }
    const result = await upgradeProspectLive(db as unknown as Db, prospect.id);
    const detail = result.contact
      ? `${result.contact.name ?? "?"} — ${result.contact.role} <${result.contact.email}> (${result.contact.source}, ${result.contact.verifier}, ${result.contact.confidence})`
      : `${result.reason}${result.hint ? ` · ${result.hint.text}` : ""}`;
    console.log(`${prospect.company_name} | ${result.status} | ${detail} | crédits ${result.calls.domainSearch + result.calls.finder + result.calls.verifier}`);
    if (result.status === "kept") misses.push(`${prospect.company_name} <${prospect.email}>${result.hint ? ` → ${result.hint.text}` : ""}`);
    if (result.status === "skipped" && result.reason.startsWith("Hunter épuisé")) break;
    if (result.status === "upgraded" && result.contact) {
      upgraded += 1;
      flagged += result.flagged;
      const pain = prospect.brief?.pain?.task ?? prospect.pain_point ?? "—";
      examples.push({ company: prospect.company_name, role: `${result.contact.name ?? "?"} — ${result.contact.role}`, topic: topicOf(pain), pain });
    }
  }

  // Générique restante (brouillon verrouillé, etc.), hors opposées et « ne plus
  // contacter » : « À l'attention de <dirigeant> » pour le générateur, sans crédit.
  const { stock: remaining } = await loadStock(userId);
  let hinted = 0;
  for (const prospect of remaining.filter(isGenericAddress)) {
    const figures = prospect.key_figures ?? {};
    const previous = figures.addressee_hint as { name?: string } | undefined;
    // Un indice d'avant v3 portait tous les prénoms du registre : il est refait.
    const stale = Boolean(previous?.name && previous.name.split(" ").length > 2);
    if (prospect.do_not_contact || figures.refuses_prospecting === true || (previous && !stale)) continue;
    const leader = usagePerson(typeof figures.leader_person === "string" ? figures.leader_person : null);
    const hint = leader?.first && leader.last ? addresseeHint({ firstName: leader.first, lastName: leader.last, role: "dirigeant", source: "registre" }) : null;
    if (!hint) continue;
    await db.from("prospects").update({ key_figures: { ...figures, addressee_hint: hint } } as never).eq("id", prospect.id);
    hinted += 1;
  }

  const after = nominativeShare(remaining);
  console.log("\n=== RAPPORT ===");
  console.log(`Nominatif sur le stock : avant ${pct(before)} → après ${pct(after)}`);
  console.log(`Fiches passées en nominatif : ${upgraded} ; brouillons marqués « à régénérer » : ${flagged}`);
  console.log(`Crédits Hunter consommés par ce run : ${await hunterCreditsSince(started)}`);
  console.log(`« À l'attention de… » posé sur ${hinted} fiche(s) restée(s) générique(s) (sans crédit)`);
  console.log(`Sans résultat Hunter (${misses.length}) :`);
  for (const miss of misses) console.log(`  · ${miss}`);
  console.log("Exemples (entreprise · contact retenu · sujet du mail) :");
  for (const example of examples.slice(0, 5)) console.log(`  · ${example.company} · ${example.role} · ${example.pain} [${example.topic}]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
