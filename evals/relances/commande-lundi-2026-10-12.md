# Régénération des relances — lundi 12/10/2026 (préparée, NON exécutée)

Mode B pour toutes (mode A coupé par défaut, réglage `RELANCE_MODE_A`, Cowork #17).
Étalonnage de validation : `etalonnage-2026-10-09-v6.md` (8/8 prêtes, 0,013 €).

**Préalable — Axel retire d'abord la validation** des relances à régénérer. La commande
n'agit QUE sur des relances non validées, non programmées, non retouchées à la main
(`validated_at` nul, contrôlé à la lecture ET dans l'`update`). Tant qu'elles sont
validées, elle répond « 0 relance(s) en attente » (vérifié le 09/10 en `--dry`).
Rien n'est envoyé ni supprimé : chaque brouillon est réécrit en place, dans son fil.
ESPACE 3000 n'est jamais touchée (refus codé, même nommée).

Depuis `C:\Users\atlas\orion-plateformes`, à jour de `main` :

```sh
npx tsc -p tsconfig.test.json
```

## 1. Les 7 relances à régénérer

AKTID, LE PAIN DE BELLEDONNE, SPI ENERGIE, LIFTVRAC, TEOPLUS, GRAPHIC PROCEDE, BONNEAU SAS.

```sh
# lecture seule : la liste visée (doit afficher 7)
node -r ./scripts/alias.cjs .test-build/scripts/relances-9-live.js --appliquer --dry "--prospects=AKTID,LE PAIN DE BELLEDONNE,SPI ENERGIE,LIFTVRAC,TEOPLUS,GRAPHIC PROCEDE,BONNEAU SAS"
# régénération (plafond 0,17 € ≈ 0,2 $)
node -r ./scripts/alias.cjs .test-build/scripts/relances-9-live.js --appliquer --plafond=0.17 "--prospects=AKTID,LE PAIN DE BELLEDONNE,SPI ENERGIE,LIFTVRAC,TEOPLUS,GRAPHIC PROCEDE,BONNEAU SAS"
```

## 2. Séparément, si Axel dévalide aussi les 6 autres

GATINE, NORDISK, CASTE ING, THIBAULT BERGERON, CAREA SANITAIRE, FONDERIE DE LA BRUCHE —
visées seulement si nommées ici (jamais par un `--appliquer` sans liste).

```sh
node -r ./scripts/alias.cjs .test-build/scripts/relances-9-live.js --appliquer --dry "--prospects=GATINE,NORDISK,CASTE ING,THIBAULT BERGERON,CAREA SANITAIRE,FONDERIE DE LA BRUCHE"
node -r ./scripts/alias.cjs .test-build/scripts/relances-9-live.js --appliquer --plafond=0.17 "--prospects=GATINE,NORDISK,CASTE ING,THIBAULT BERGERON,CAREA SANITAIRE,FONDERIE DE LA BRUCHE"
```

Séparateur « , » obligatoire : sous Windows, `|` dans un argument est pris pour un tuyau.
Les deux lots se lancent en deux commandes : les questions de fin varient dans chaque lot.
