# Compta — micro-entreprise d'Axel (Cowork #70)

Module `/compta` d'ORION : devis, factures et avoirs, encaissements (livre des recettes), dépenses, déclaration URSSAF trimestrielle, seuils. Accès réservé à Axel.

**Profil** : micro-entreprise en BNC, activité libérale non réglementée (SSI), début le 01/09/2026, ACRE, déclaration trimestrielle, sans versement libératoire, franchise en base de TVA. SIRET 109 144 477 00014.

## Où est quoi

| Sujet | Fichier |
| --- | --- |
| Valeurs réglementaires (taux, seuils, mentions), avec leurs sources | `lib/compta/config.ts` |
| Calculs purs (totaux, statuts de paiement, trimestres, jauges) | `lib/compta/calculs.ts`, `urssaf.ts`, `tableau.ts` |
| PDF sans dépendance (Helvetica, WinAnsi) | `lib/compta/pdf/` |
| Livre des recettes (CSV et PDF) | `lib/compta/recettes.ts` |
| Données : Supabase (RLS) ou mémoire (démo et tests) | `lib/compta/depot*.ts` |
| Écrans et actions | `app/compta/**`, `components/compta/**` |
| Base : tables, numérotation, immuabilité, RLS, bucket privé | `supabase/migrations/20261119090000_compta_init.sql` |

## Garanties portées par la base

- **Numérotation sans trou.**
  - Une facture naît en brouillon, sans numéro.
  - `compta_emettre()` lui attribue `F-AAAA-NNN` (ou `A-AAAA-NNN` pour un avoir) avec la date du jour (Paris).
  - Le compteur est incrémenté dans la même transaction : deux émissions simultanées se suivent, et une émission annulée ne consomme aucun numéro.
  - Les devis sont numérotés `D-AAAA-NNN` dès leur création.
- **Facture émise immuable.**
  - Ni modification ni suppression (trigger).
  - Elle passe en « émise » seulement par `compta_emettre()`.
  - Les coordonnées de l'émetteur et du client sont **figées** à l'émission.
  - La seule correction possible est un **avoir** (F23208), qui ne peut pas dépasser le restant de la facture.
- **Total recalculé** par la base à partir des lignes.
- **Encaissement** seulement sur une facture émise du même client (ou sans facture, avec client et nature).
- **Journal** (`compta_journal`) : création, modification, émission et changement de statut des devis et des factures.
- **Accès** :
  - RLS `owner_id = auth.uid()` sur toutes les tables, avec les GRANT correspondants ;
  - bucket `compta-justificatifs` privé, un dossier par compte, liens signés de 5 minutes ;
  - les pages exigent une session (middleware) et, si `COMPTA_EMAIL` est défini sur Vercel, ce compte seul (404 sinon).
  - **Recommandé** : définir `COMPTA_EMAIL` avec l'adresse de connexion d'Axel.

Les statuts « payée partiellement », « payée », « en retard » et « soldée par avoir » sont **calculés**, à partir des encaissements, des avoirs et de l'échéance. Ils ne sont jamais stockés.

## Sources officielles (lues le 18/11/2026)

### Mentions obligatoires de la facture

Sources : [F31808](https://entreprendre.service-public.gouv.fr/vosdroits/F31808) (vérifié le 11/08/2026) et [F36008](https://entreprendre.service-public.gouv.fr/vosdroits/F36008) (micro-entreprise, vérifié le 08/12/2025).

Ce que le PDF imprime :

| Mention | Ce que porte le PDF |
| --- | --- |
| Numéro | Numéro unique, chronologique et continu |
| Dates | Date d'émission ; date ou période de la prestation |
| Émetteur | Nom suivi de la mention **« EI »**, adresse, SIRET |
| Client | Nom ; adresse pour un particulier ; SIREN s'il est connu |
| Lignes | Désignation, quantité, prix unitaire HT, total HT |
| TVA | « **TVA non applicable, art. 293 B du CGI** » |
| Échéance | Date de règlement |
| Escompte | « Escompte pour paiement anticipé : néant » |
| Pénalités de retard | « 3 fois le taux d'intérêt légal », exigibles sans rappel ; c'est le minimum légal ([F23211](https://entreprendre.service-public.gouv.fr/vosdroits/F23211), vérifié le 07/08/2026) |
| Recouvrement | **Indemnité forfaitaire de 40 €**, sur les factures des clients professionnels seulement |

Contrôle : `scripts/compta.test.ts` vérifie la présence de ces mentions dans les PDF générés.

Deux points de calendrier :
- **Mention CIBS** : le [BOFiP (ACTU-2026-00126, 07/10/2026)](https://bofip.impots.gouv.fr/bofip/15140-PGP.html/ACTU-2026-00126) reporte au 01/01/2027 l'entrée en vigueur du CIBS pour la TVA. Les anciennes références au CGI restent utilisables jusqu'au 30/06/2028. [impots.gouv.fr](https://www.impots.gouv.fr/professionnel/questions/en-tant-que-micro-entrepreneur-puis-je-etre-redevable-de-la-tva) (modifiée le 14/10/2026) accepte les deux formulations. La page F36008, qui annonçait le changement au 01/09/2026, est périmée sur ce point.
- **Facturation électronique** ([F39785](https://entreprendre.service-public.gouv.fr/vosdroits/F39785), vérifié le 07/08/2026) :
  - réception obligatoire dès le 01/09/2026 ;
  - émission B2B pour les micro-entreprises au **01/09/2027**, avec quatre nouvelles mentions : SIREN du client, adresse de livraison, nature des opérations (« prestations de services »), option TVA sur les débits.
  - À prévoir avant septembre 2027 : passer par une plateforme agréée. Ce module produit des PDF, pas des factures électroniques au sens de la réforme.

### Cotisations sociales

Taux : **25,6 %** du CA encaissé depuis le 01/01/2026, plus la CFP de 0,2 %.
- [urssaf.fr](https://www.urssaf.fr/accueil/actualites/taux-cotisations-autoentrepeneur.html) (mis à jour le 30/01/2026) ;
- [autoentrepreneur.urssaf.fr, « L'essentiel du statut »](https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/lessentiel-du-statut.html).

L'ancien taux de 26,1 % annoncé en 2024 n'a pas été appliqué.

### ACRE

Pour une création à compter du 01/07/2026 : **75 % du taux normal**, soit **19,2 %**, jusqu'à la fin du 3e trimestre civil suivant le début. Pour Axel : du **01/09/2026 au 30/06/2027**.
- [F11677](https://entreprendre.service-public.gouv.fr/vosdroits/F11677) (vérifié le 01/07/2026) ;
- [décret n° 2026-69](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053449085) ;
- tableau URSSAF.

### Déclarations trimestrielles

Échéances : 30/04, 31/07, 31/10 et 31/01 de l'année suivante, reportées au jour ouvré suivant si elles tombent un samedi, un dimanche ou un jour férié. Source : page « L'essentiel du statut » de l'URSSAF.

Première déclaration :
- au moins 90 jours après le début d'activité ;
- début entre le 1er juillet et le 30 septembre : exigible le 31 janvier suivant.
- Pour Axel : période du **01/09/2026 au 31/12/2026**, à déclarer au plus tard le **lundi 01/02/2027** (le 31/01 tombe un dimanche).

### Plafonds et seuils

| Seuil | Valeur | Source |
| --- | --- | --- |
| Plafond micro (BNC) | **83 600 €**, proratisé l'année de création (27 943 € en 2026) | [F32353](https://entreprendre.service-public.gouv.fr/vosdroits/F32353) (vérifié le 21/02/2026) |
| Franchise de TVA | Seuil **37 500 €**, seuil majoré **41 250 €**, inchangés en 2026 (le seuil unique de 25 000 € a été abandonné) | [F21746](https://entreprendre.service-public.gouv.fr/vosdroits/F21746) (vérifié le 01/01/2026) |

### Livre des recettes

Chronologique : client, montant, date, mode de règlement, espèces distinguées, référence de la pièce. À conserver 10 ans. Source : [F36018](https://entreprendre.service-public.gouv.fr/vosdroits/F36018) (vérifié le 21/02/2026).

Le module y ajoute :
- des totaux par trimestre ;
- un export CSV (séparateur « ; », décimale à virgule) et PDF.

**Ces valeurs changent** : les revérifier chaque année dans `lib/compta/config.ts`. Aucun taux ni seuil 2027 n'était publié le 18/11/2026.

## Points à faire vérifier par un expert-comptable

1. La formulation de la mention de franchise à partir du 01/01/2027 (référence CIBS : « L. 223-3 » ou « L. 233-3 », les pages officielles divergent). « Art. 293 B du CGI » est conservé ici, accepté au moins jusqu'au 30/06/2028 d'après le BOFiP.
2. La CFP (0,2 %) pendant l'ACRE : réduite ou non ? L'estimation la laisse pleine.
3. La période couverte par la première déclaration (01/09 → 31/12/2026). Elle est déduite de la règle des 90 jours et du tableau URSSAF ; elle n'est pas écrite telle quelle.
4. Le jour exact de perte de la franchise de TVA en cas de dépassement du seuil majoré : le **jour** (service-public, impots.gouv) ou le **mois** (URSSAF) ? Et le prorata des seuils la 2e année.
5. Le numéro de TVA intracommunautaire sur une facture de plus de 150 € HT à un professionnel, pour un franchisé.
6. L'éligibilité à l'ACRE et sa demande dans les 60 jours.
7. Les avoirs : série dédiée `A-AAAA-NNN` (F23208 cite cet exemple) plutôt que la série des factures.
8. Les CA des jauges sont calculés sur les **encaissements** (logique BNC et URSSAF) ; à confirmer pour la franchise de TVA des prestations de services.

## Tests

| Commande | Ce qu'elle couvre |
| --- | --- |
| `npm run test:compta` | Sans base : numérotation, immuabilité, avoir, statuts, livre des recettes, trimestre, URSSAF et ACRE, seuils, mentions des PDF, accès |
| `npm run test:compta-sql` | Sur un Postgres **jetable**, avec `COMPTA_PG_URL=postgres://postgres@localhost:5455/postgres`. Le script refuse toute URL Supabase. Il couvre : migrations rejouées, 30 émissions **simultanées** sans trou, rollback, immuabilité, avoir, RLS entre deux comptes. Rejoué en CI par `.github/workflows/compta-sql.yml` (service postgres:17). |

## Mode démo local (captures, essais)

`COMPTA_DEMO=1 npx next dev` lance la compta avec des données **fictives** en mémoire. Il n'y a ni session ni écriture en base. Ce mode est inactif dès que `NODE_ENV=production` : `next start` et Vercel.
