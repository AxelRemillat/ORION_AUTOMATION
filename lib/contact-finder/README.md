# Module contact (`lib/contact-finder`)

Trouve le **site officiel** et **l'adresse à laquelle écrire** quand la fiche
n'en a pas, ou que Hunter ne renvoie rien.

```ts
import { findContact } from "@/lib/contact-finder";
const result = await findContact(prospectId); // ContactResult, écrit sur la fiche
```

## Chemin

1. **Identité** (`sources.ts`) : fiche → annuaire public (noms commerciaux,
   enseignes, dirigeant) → Pappers en cache (site déclaré, représentants).
   Dirigeant au **nom d'usage** : « BRIOL Séverine née NASSIF » → Briol.
2. **Domaines candidats** (`finder.ts`) : site connu, site Pappers, domaine de
   l'adresse connue ; puis Linkup (≤ 3) : `"<nom commercial>" <ville>`,
   `"<raison sociale>" mentions légales`, `"<SIREN>" mentions légales`.
   Annuaires et réseaux écartés **avant** lecture (`domains.ts`).
3. **Validation** (`validate.ts`) : accueil + mentions légales / contact /
   à-propos (≤ 8 pages). Validé si SIREN/SIRET (90), raison sociale + ville
   (75), raison sociale (60), dirigeant + ville (60). Un modèle (1 appel au plus,
   `OPENAI_MODEL_CONTACT`, défaut `gpt-6-luna`) ne sert qu'à départager.
4. **Extraction** (`extract.ts`) : adresses en clair ou masquées (`[at]`,
   `(at)`, `&#64;`), et les **domaines d'adresse** ≠ domaine du site.
5. **Hunter** : domain-search sur les domaines d'adresse (≤ 2), email-finder sur
   le dirigeant (≤ 1), email-verifier sur les nominatifs (≤ 3).
6. **Priorité** : nominatif `valid` > nominatif `accept_all` (jamais pour une
   adresse devinée) > générique publié sur le site > rien.

Écrit sur la fiche : `website` (si vide ou saisi), `email` (jamais par-dessus
une adresse saisie à la main), `email_type`, `email_source_url`,
`contact_confidence`, `contact_found_by`, `contact_search` (journal et
dépenses), `contact_checked_at`.

## Compte rendu (`report.ts`)

Sous le résultat, la carte Contact affiche « Recherches effectuées » (ouvert
d'office en cas d'échec) : requêtes Linkup au mot près, domaines écartés sans
lecture et leur motif (annuaire, réseau social, hébergeur…), pages lues et ce
qui y a été cherché, appels Hunter et leur résultat, coût. Une conclusion en
une phrase (« Aucun site ne mentionne ce SIREN : l'entreprise n'a probablement
pas de site. »). Tout est déduit du journal `contact_search` — aucun modèle.
Les 5 conclusions précédentes sont gardées dans `contact_search.history`.

## Déclenchement

- Bouton « Trouver le contact (IA) » et site éditable : carte Contact sur
  /prospection et sur la fiche Suivi (job `reanalyze`, `scope: "contact"`).
- Automatique : après une réanalyse qui laisse la fiche sans site ou sans
  adresse ; dans la génération de mail quand Hunter ne trouve rien.
- Programmation d'un envoi : déjà refusée sans destinataire valide
  (`lib/outbox/scheduler.ts`, non modifié).

## Tests

- `npm run test:contact` : HTML des 3 cas (BRIOL, BONNIN, ARTFLEX), règles,
  budget, écriture sur la fiche. Fixtures dans `scripts/fixtures/contact-finder`.
- `npm run test:contact-report` : compte rendu sur GLOBAL 2F (pas de site) et
  BRIOL (site trouvé), nom en double.
- `npm run contact:live -- <siren> [--save]` : test réel, **payant**, en local.

## Contact nominatif selon le sujet du mail (`nominative.ts`, `upgrade.ts`)

Une adresse GÉNÉRIQUE (contact@, info@…) n'est qu'un dernier recours. Dès
qu'elle est trouvée (creusage, complétion — `lib/funnel/live.ts`), ORION
cherche la personne dont la fonction correspond au **sujet du brouillon**
(`brief.pain.task`, sinon `pain_point`) :

| Sujet | Rôles visés, dans l'ordre |
| --- | --- |
| factures, relances de paiement, comptabilité | DAF, responsable comptable/administratif, dirigeant |
| tri des e-mails, SAV, service client | service client, ADV, office manager, dirigeant |
| devis, prix, commandes, ADV | directeur commercial, ADV, dirigeant |
| comptes rendus, documents, fichier clients | dirigeant, responsable administratif |
| < 20 salariés | le dirigeant d'abord, quel que soit le sujet |

Hunter : Domain Search filtré (type personnel, départements utiles), meilleur
poste à confiance ≥ 80 → sinon Email Finder sur le dirigeant (nom d'usage) →
Email Verifier : `valid`, ou `accept_all` à confiance ≥ 90. Rien de sûr : la
générique reste. Garde-fou Hunter inchangé (cache 90 jours, `HUNTER_DAILY_BUDGET`,
80 par défaut). Une fiche n'est pas recherchée deux fois en 90 jours.

Écrit `contact_name`, `contact_role`, `contact_source` (affichés « Contact :
Prénom Nom — Poste (Hunter, confiance 94 %) ») ; la salutation et l'angle du
mail suivent la personne contactée. Jamais pour une fiche opposée, à
l'opposition non vérifiée, « ne plus contacter », déjà contactée, ni quand un
brouillon est validé, programmé ou retouché à la main. Les brouillons libres
sont marqués « à régénérer » (`messages.regenerate_reason`).

Rattrapage du stock : `npm run contacts:nominatifs` (simulation, 0 crédit),
puis `-- --apply [--limit N] [--max-credits N]` (réel, **payant**).
