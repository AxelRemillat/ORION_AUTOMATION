# Qualité de l'enrichissement

Généré le 2026-09-24 19:15 sur les 3 derniers prospects.

## Couverture

| Indicateur | Taux | Détail |
| --- | --- | --- |
| Contact nominatif | 33 % | 1/3 |
| Dirigeant personne physique | 67 % | 2/3 |
| Site trouvé ET lu | 33 % | 1/3 |
| Au moins 1 signal frais daté | 0 % | 0/3 |
| Signaux non datés | — | 0/0 |
| Filiales de grands groupes | 0 % | 0/3 |

## Coût

| Poste | Montant |
| --- | --- |
| **Moyenne par prospect** | **0,0036 €** |
| Total imputé à ces prospects | 0,0109 € |
| Dépenses non imputées (scan, recherches) | 0,2076 € |

Par service, sur les appels imputés à ces prospects :

| Service | Coût |
| --- | --- |
| openai | 0,009 € |
| linkup | 0,0018 € |
| hunter | 0,00 € |

> Les crédits Pappers et les recherches Hunter valent 0 € tant que
> `PAPPERS_CREDIT_EUR` et `HUNTER_SEARCH_EUR` ne sont pas renseignés : leur
> consommation est comptée exactement, leur prix dépend du forfait.

## Détail par prospect

| Entreprise | Score | Site | Dirigeant | Contact | Signaux frais | Filiale |
| --- | --- | --- | --- | --- | --- | --- |
| RAS (RAS INTERIM JERECRUTE) | 7 | non trouvé | — | — | 0/0 | non |
| BLUE ENERFREEZE | 7 | lu | Benjamin Dumont | benjamin.dumont@blue-enerfreeze.com | 0/0 | non |
| JACQUET PARIS | 30 | non trouvé | Philippe Goczol | — | 0/0 | non |

## Précision des faits

Remplissez la colonne `correct_o_n` de `enrichment-audit.csv` (o / n), puis :

```
npx tsx scripts/enrichment-metrics.ts --audit enrichment-audit.csv
```
