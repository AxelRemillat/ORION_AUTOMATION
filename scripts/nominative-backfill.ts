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
 *
 * Cowork #52 : deuxième étape, RELANCE 2 VERS UNE PERSONNE — fiches dont l'intro
 * et la relance 1 sont parties sur une générique, sans réponse : un contact
 * nominatif est PROPOSÉ (`key_figures.relance2_contact`), sans rien envoyer ni
 * reprogrammer. Même plafond de crédits pour les deux étapes. `--no-relance2`
 * pour ne faire que le stock.
 *
 * Cowork #53 : troisième étape, FICHES SANS E-MAIL — recherche de contact
 * (site, Email Finder dirigeant, Domain Search ; jamais Linkup) sur celles qui
 * ont un vrai domaine, hors cible / opposées / perdues / « ne plus contacter »
 * exclues (lib/contact-finder/no-email.ts). Même plafond. `--no-sans-email`
 * pour l'écarter. Lancer avec USAGE_SOURCE=agent1 pour tracer la dépense.
 */
import { db, ownerId } from "./quality-live";
import { readAll } from "@/lib/supabase/read-all";
import { proposeRelance2Live, upgradeProspectLive } from "@/lib/contact-finder/nominative-live";
import { relance2Ineligibility, type SentRow } from "@/lib/contact-finder/relance2";
import { noEmailIneligibility, type NoEmailProspect } from "@/lib/contact-finder/no-email";
import { findContact } from "@/lib/contact-finder";
import { segmentOf } from "@/lib/segments";
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
const RELANCE2 = !process.argv.includes("--no-relance2");
const NO_EMAIL = !process.argv.includes("--no-sans-email");
/** Crédits Hunter par fiche, d'après les runs du 06/10 (recherche de domaine, finder, vérification). */
const CREDITS_PER_PROSPECT = 3;

type MessageRow = Parameters<typeof isFreeDraft>[0] & { prospect_id: string; sent_to: string | null };

async function hunterCreditsSince(since: string): Promise<number> {
  const rows = await readAll<{ units: number }>(() => db.from("api_usage").select("units").eq("service", "hunter").gte("created_at", since).order("id"));
  return rows.reduce((total, row) => total + (Number(row.units) || 0), 0);
}

async function loadStock(userId: string) {
  const prospects = await readAll<UpgradeProspect>(() => db.from("prospects").select("*").eq("user_id", userId).is("deleted_at", null).order("id"));
  const messages = await readAll<MessageRow>(() =>
    db.from("messages").select("id, prospect_id, type, status, send_status, validated_at, edited_by_hand, scheduled_at, deleted_at, sent_to").eq("user_id", userId).order("id"),
  );
  const byProspect = new Map<string, MessageRow[]>();
  for (const row of messages) if (!row.deleted_at && row.type !== "note") byProspect.set(row.prospect_id, [...(byProspect.get(row.prospect_id) ?? []), row]);
  // Le STOCK : fiches avec une adresse, pas encore contactées.
  const stock = prospects.filter((prospect) => prospect.email && !(byProspect.get(prospect.id) ?? []).some((row) => row.status === "sent"));
  // RELANCE 2 : contactés, intro + relance 1 parties sur une générique, sans réponse.
  const relance2 = prospects.filter((prospect) => relance2Ineligibility(prospect, (byProspect.get(prospect.id) ?? []) as SentRow[]) === null);
  // SANS E-MAIL : vrai domaine, ni hors cible, ni opposée, ni perdue, ni « ne plus contacter ».
  const noEmail = prospects.filter((prospect) => noEmailIneligibility(prospect as unknown as NoEmailProspect) === null);
  return { stock, byProspect, relance2, noEmail };
}

const pct = (share: { nominative: number; total: number }) => (share.total ? `${Math.round((share.nominative / share.total) * 100)} % (${share.nominative}/${share.total})` : "—");

async function main() {
  const userId = await ownerId();
  const started = new Date().toISOString();
  const { stock, byProspect, relance2, noEmail } = await loadStock(userId);
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

  console.log(`Relance 2 vers une personne (intro + relance 1 sur une générique, sans réponse) : ${RELANCE2 ? relance2.length : "désactivé"}`);
  console.log(`Sans e-mail, avec un vrai domaine (ni hors cible, ni opposée, ni perdue) : ${NO_EMAIL ? noEmail.length : "désactivé"}`);
  // Répartition par famille (segment) de tout ce qui consommerait un crédit.
  const families = new Map<string, number>();
  for (const prospect of [...candidates.slice(0, LIMIT), ...(RELANCE2 ? relance2 : []), ...(NO_EMAIL ? noEmail : [])]) {
    const family = segmentOf(prospect as never) ?? "sans segment";
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  console.log(`Par famille : ${[...families].sort((a, b) => b[1] - a[1]).map(([family, count]) => `${family} ${count}`).join(" · ")}`);
  if (!APPLY) {
    const fiches = Math.min(candidates.length, LIMIT) + (RELANCE2 ? relance2.length : 0) + (NO_EMAIL ? noEmail.length : 0);
    console.log(`\nSIMULATION (aucun appel Hunter, aucune écriture). ${fiches} fiche(s) : au plus ~${fiches * CREDITS_PER_PROSPECT} crédits Hunter (plafond du run : ${MAX_CREDITS}).`);
    for (const prospect of candidates.slice(0, 20)) console.log(`  · ${prospect.company_name} <${prospect.email}> — sujet : ${topicOf(prospect.brief?.pain?.task ?? prospect.pain_point)}`);
    for (const prospect of (RELANCE2 ? relance2 : []).slice(0, 20)) console.log(`  · relance 2 · ${prospect.company_name} <${prospect.email}>`);
    for (const prospect of (NO_EMAIL ? noEmail : []).slice(0, 40)) console.log(`  · sans e-mail · ${prospect.company_name} (${prospect.website})`);
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

  // RELANCE 2 : proposition d'un contact nominatif, sous le même plafond.
  let proposed = 0;
  for (const prospect of RELANCE2 ? relance2 : []) {
    if ((await hunterCreditsSince(started)) >= MAX_CREDITS) {
      console.log(`arrêt : plafond du run atteint (${MAX_CREDITS} crédits)`);
      break;
    }
    const result = await proposeRelance2Live(db as unknown as Db, prospect.id);
    console.log(`relance 2 · ${prospect.company_name} | ${result.status} | ${result.reason} | crédits ${result.calls.domainSearch + result.calls.finder + result.calls.verifier}`);
    if (result.status === "skipped" && result.reason.startsWith("Hunter épuisé")) break;
    if (result.status === "proposed") proposed += 1;
  }

  // SANS E-MAIL : recherche de contact (site, Email Finder dirigeant, Domain Search ; pas de Linkup).
  let foundNoEmail = 0;
  let nominativeNoEmail = 0;
  for (const prospect of NO_EMAIL ? noEmail : []) {
    if ((await hunterCreditsSince(started)) >= MAX_CREDITS) {
      console.log(`arrêt : plafond du run atteint (${MAX_CREDITS} crédits)`);
      break;
    }
    const found = await findContact(prospect.id, { db: db as never, userId, linkup: 0 }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }) as { error: string });
    if ("error" in found) {
      console.log(`sans e-mail · ${prospect.company_name} | erreur : ${found.error}`);
      continue;
    }
    console.log(`sans e-mail · ${prospect.company_name} | ${found.email ? `${found.email} (${found.email_type ?? "?"}, ${found.found_by}, ${found.confidence})` : `aucune — ${found.found_by}`}`);
    if (/Hunter épuisé/.test(found.found_by ?? "")) break;
    if (found.email) {
      foundNoEmail += 1;
      if (found.email_type === "nominatif") nominativeNoEmail += 1;
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
  const spent = await hunterCreditsSince(started);
  console.log(`Relance 2 : contact nominatif proposé sur ${proposed} fiche(s)`);
  console.log(`Sans e-mail → contact trouvé : ${foundNoEmail} fiche(s), dont ${nominativeNoEmail} nominative(s)`);
  console.log(`Crédits Hunter consommés par ce run : ${spent}`);
  const nominatives = upgraded + proposed + nominativeNoEmail;
  console.log(`Coût par adresse nominative trouvée : ${nominatives ? (spent / nominatives).toFixed(1) : "—"} crédit(s) (${nominatives} adresse(s))`);
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
