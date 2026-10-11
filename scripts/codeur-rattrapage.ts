/**
 * RATTRAPAGE des offres Codeur déposées à la main (Cowork #17, autorisé par Axel).
 *
 * Axel a déposé quatre offres directement sur Codeur, sans passer par ORION :
 * leurs fiches sont donc restées « à répondre » (ou « ignorée »), sans date
 * d'envoi — donc sans relance à trois jours. Ce script écrit le statut, le
 * texte de la proposition, la date d'envoi et le montant. RIEN D'AUTRE : aucune
 * suppression, aucun champ touché hors de ceux-là.
 *
 *   npm run rattrapage:codeur -- --write
 *
 * Sans `--write`, il affiche ce qu'il ferait et ne touche à rien.
 */
import { createClient } from "@supabase/supabase-js";

const WRITE = process.argv.includes("--write");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE requis");
const db = createClient(url, key, { auth: { persistSession: false } });

/** Paris est à UTC+2 le 11 octobre : 18:20 locale = 16:20 UTC. */
const paris = (iso: string) => `${iso}+02:00`;

interface Entry {
  externalId: string;
  /** Pour la fiche sans numéro connu : on la retrouve par son titre. */
  titleLike?: string;
  sentAt: string;
  amountEur: number | null;
  /** `null` = garder le texte déjà enregistré. */
  proposal: string | null;
}

const ENTRIES: Entry[] = [
  {
    externalId: "491048",
    sentAt: paris("2026-10-11T18:20:00"),
    amountEur: 300,
    proposal: `Bonjour,

Vous voulez tester une niche avec un site d'affiliation clé en main, puis l'enrichir vous-même. C'est exactement ce que je construirais.

Ce que je propose :
1. Un site rapide et bien référencé : page d'accueil, pages catégories, modèle d'article et de comparatif avec vos liens affiliés.
2. Un espace d'édition simple pour ajouter vos articles et vos liens sans toucher au code.
3. La base SEO (titres, descriptions, plan du site, Search Console) pour que vos pages soient indexées dès le départ.

Je démarre sur Codeur : tarif de lancement de 300 € à prix fixe, livré en 7 jours, en échange d'un avis honnête à la fin.

Pour cadrer : quelle niche visez-vous, et avec quels programmes d'affiliation (Amazon, Awin, autre) ?

Axel Remillat`,
  },
  {
    externalId: "491062",
    sentAt: paris("2026-10-11T18:21:00"),
    amountEur: 400,
    proposal: `Bonjour,

Vous voulez un site internet qui se trouve sur Google dès sa mise en ligne. Je m'en occupe de bout en bout.

Ce que je propose :
1. Un site vitrine responsive (jusqu'à 5 pages), rapide et facile à faire évoluer.
2. La base SEO technique : titres et descriptions par page, balisage des contenus, plan du site, vitesse de chargement optimisée, inscription à Google Search Console.
3. Mise en ligne sur votre nom de domaine et 30 minutes de prise en main.

Je démarre sur Codeur : je vous propose un tarif de lancement de 400 € à prix fixe, livré en 7 jours, en échange d'un avis honnête à la fin de la mission.

Pour cadrer : quelle est votre activité, et avez-vous déjà les textes, le logo et un nom de domaine ?

Axel Remillat`,
  },
  {
    externalId: "491078",
    sentAt: paris("2026-10-11T18:22:00"),
    amountEur: 400,
    proposal: `Bonjour,

Cursus Plus me parle directement : je développe RISE, une startup EdTech pour les étudiants (visible dans mon portfolio Codeur).

Votre cahier des charges complet dépasse 500 €. Je vous propose donc de démarrer par une première version solide, que vous pourrez montrer à vos premiers élèves :
1. Comptes élève et tuteur.
2. Bibliothèque classée par niveau, matière et chapitre (vidéos et exercices corrigés).
3. Quiz avec suivi de progression.

Le forum à points et l'abonnement Stripe viendront en phase 2, chiffrés à part une fois la base validée.

Application web responsive, entièrement en français.
Tarif de lancement : 400 € à prix fixe pour cette première version, livrée en 3 semaines, en échange d'un avis honnête sur Codeur.

Avez-vous déjà des contenus (vidéos, exercices) prêts à intégrer ?

Axel Remillat`,
  },
  {
    // La conciergerie : Axel a répondu sur la phase IA, son texte est déjà en base.
    externalId: "490955",
    titleLike: "%conciergerie%",
    sentAt: paris("2026-10-08T18:00:00"),
    amountEur: null,
    proposal: null,
  },
];

async function main(): Promise<void> {
  console.log(WRITE ? "ÉCRITURE\n" : "SIMULATION (ajouter --write pour écrire)\n");

  for (const entry of ENTRIES) {
    const query = db
      .from("opportunities")
      .select("id, external_id, title, status, sent_at, amount_eur, proposal")
      .eq("external_id", entry.externalId);
    const { data, error } = await query;
    if (error) {
      console.log(`  ${entry.externalId} : erreur de lecture — ${error.message}`);
      continue;
    }
    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (!row) {
      console.log(`  ${entry.externalId} : AUCUNE FICHE — à créer par l'ingest avant de rejouer`);
      continue;
    }

    const patch: Record<string, unknown> = {
      status: "envoyee",
      sent_at: new Date(entry.sentAt).toISOString(),
    };
    if (entry.amountEur !== null) patch.amount_eur = entry.amountEur;
    // `null` = garder le texte existant : on ne remplace jamais ce qu'Axel a écrit.
    if (entry.proposal !== null) patch.proposal = entry.proposal;

    const before = `statut=${row.status} envoyée=${row.sent_at ?? "—"} montant=${row.amount_eur ?? "—"} texte=${row.proposal ? `${String(row.proposal).length} car.` : "aucun"}`;
    console.log(`  ${entry.externalId} « ${String(row.title ?? "").slice(0, 46)} »`);
    console.log(`    avant : ${before}`);
    console.log(
      `    après : statut=envoyee envoyée=${String(patch.sent_at).slice(0, 16)} montant=${patch.amount_eur ?? row.amount_eur ?? "—"} texte=${
        entry.proposal ? `${entry.proposal.length} car. (écrit)` : `${row.proposal ? String(row.proposal).length : 0} car. (conservé)`
      }`,
    );

    if (!WRITE) continue;
    const { error: writeError } = await db.from("opportunities").update(patch).eq("id", row.id as string);
    console.log(writeError ? `    ÉCHEC : ${writeError.message}` : "    écrit");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
