# Migrations Supabase : mise en route de l'application automatique

Depuis `.github/workflows/migrate.yml`, les migrations de `supabase/migrations/`
sont appliquées par GitHub Actions à chaque merge sur `main` qui en modifie une
(`supabase db push`). Plus de SQL à coller à la main.

La CLI Supabase sait quelles migrations sont déjà passées grâce à la table
`supabase_migrations.schema_migrations`. Les migrations collées jusqu'ici dans
le SQL Editor n'y figurent pas. **Il y a donc deux cas.**

## Préalable : la chaîne de connexion « Session pooler »

Dashboard Supabase → bouton **Connect** (en haut du projet) → onglet
**Connection string** → **Session pooler**. Elle ressemble à :

```
postgresql://postgres.<project-ref>:<MOT-DE-PASSE>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

- Prendre **Session pooler** (IPv4), pas « Direct connection » : la connexion
  directe est en IPv6, injoignable depuis les runners GitHub.
- Remplacer `<MOT-DE-PASSE>` par le mot de passe de la base (Project Settings →
  Database). S'il contient des caractères spéciaux (`@ : / ? # %`), les encoder
  (`@` → `%40`, `#` → `%23`…), sinon l'URL est mal lue.

Puis créer le secret GitHub : dépôt → **Settings → Secrets and variables →
Actions → New repository secret**, nom `SUPABASE_DB_URL`, valeur = cette chaîne.
Sans ce secret, le workflow s'affiche « skipped » : rien n'est appliqué, rien
n'échoue.

## Cas 1 — la base actuelle, migrations déjà appliquées à la main

À faire **une seule fois, en local, AVANT de créer le secret** (sinon le
premier push tenterait de tout rejouer et échouerait dès `init.sql` sur
« type prospect_status already exists » — sans dégât, chaque migration étant
dans sa propre transaction, mais sans rien appliquer non plus).

```bash
export SUPABASE_DB_URL='postgresql://postgres.<project-ref>:<MOT-DE-PASSE>@aws-0-<region>.pooler.supabase.com:5432/postgres'

# 1. Marquer comme appliquées les migrations déjà passées à la main
npx supabase migration repair --status applied 20260907000000 20260907120000 20260908000000 20260920100000 20260920110000 20260920120000 20260924100000 20260924110000 20260924120000 --db-url "$SUPABASE_DB_URL"

# 2. Vérifier : chaque ligne doit avoir la même version en LOCAL et en REMOTE
npx supabase migration list --db-url "$SUPABASE_DB_URL"

# 3. Contrôle final : doit répondre « Remote database is up to date »
npx supabase db push --db-url "$SUPABASE_DB_URL" --dry-run
```

Détail, fichier par fichier (équivalent à la commande groupée ci-dessus) :

| Fichier | Commande |
| --- | --- |
| `20260907000000_init.sql` | `npx supabase migration repair --status applied 20260907000000 --db-url "$SUPABASE_DB_URL"` |
| `20260907120000_prospects_email.sql` | `npx supabase migration repair --status applied 20260907120000 --db-url "$SUPABASE_DB_URL"` |
| `20260908000000_orion_grants.sql` | `npx supabase migration repair --status applied 20260908000000 --db-url "$SUPABASE_DB_URL"` |
| `20260920100000_purge_unproven_signals.sql` | `npx supabase migration repair --status applied 20260920100000 --db-url "$SUPABASE_DB_URL"` |
| `20260920110000_api_usage.sql` | `npx supabase migration repair --status applied 20260920110000 --db-url "$SUPABASE_DB_URL"` |
| `20260920120000_favorites.sql` | `npx supabase migration repair --status applied 20260920120000 --db-url "$SUPABASE_DB_URL"` |
| `20260924100000_inbound_messages.sql` | `npx supabase migration repair --status applied 20260924100000 --db-url "$SUPABASE_DB_URL"` |
| `20260924110000_action_states.sql` | `npx supabase migration repair --status applied 20260924110000 --db-url "$SUPABASE_DB_URL"` |
| `20260924120000_enrichment_cache.sql` | `npx supabase migration repair --status applied 20260924120000 --db-url "$SUPABASE_DB_URL"` |

Migration `20260925100000_prospect_brief.sql` (PR du stratège) : si elle a
déjà été collée à la main, l'ajouter à la commande de réparation une fois la PR
mergée ; sinon, ne rien faire, la CI l'appliquera au merge. Elle est
idempotente (`add column if not exists`), donc la rejouer est sans effet.

Une migration collée à la main par erreur plus tard ? Même remède :
`npx supabase migration repair --status applied <version> --db-url "$SUPABASE_DB_URL"`.

## Cas 2 — projet Supabase neuf

Rien à réparer : la table d'historique n'existe pas encore et aucune migration
n'a été appliquée. Créer le secret `SUPABASE_DB_URL` avec la chaîne du nouveau
projet, puis lancer le workflow à la main (**Actions → Migrations Supabase →
Run workflow**) : le premier `db push` crée tout, dans l'ordre des fichiers.
Mettre ensuite à jour `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
et `SUPABASE_SERVICE_ROLE` (Vercel et `.env.local`) vers ce projet.

## Ensuite, au quotidien

- Une nouvelle migration = un nouveau fichier `AAAAMMJJHHMMSS_nom.sql`,
  idempotent, jamais la modification d'un fichier déjà appliqué.
- Sur chaque PR, la CI lance `npm run check:migrations` : DROP TABLE,
  DROP COLUMN, TRUNCATE, DELETE sans WHERE et GRANT/REVOKE hors `public` sont
  refusés, sauf en-tête `-- allow-destructive: <raison>`.
- Au merge, `migrate.yml` applique les nouvelles migrations. En cas d'échec, le
  résumé du job nomme la migration fautive ; les suivantes ne sont pas appliquées.
- Aperçu sans rien appliquer : **Run workflow** avec « dry_run » coché.
