# CLAUDE.md — consignes pour les agents qui travaillent sur ORION

Application : PROSPECT (Next.js 14, Supabase, OpenAI, n8n). Voir README.md
pour l'architecture et CONTRACT.md pour le design system.

Vérifications à lancer avant tout push : `npx tsc --noEmit`, `npm run lint`,
`npm test`, `npm run build` (placeholders `NEXT_PUBLIC_SUPABASE_URL` et
`NEXT_PUBLIC_SUPABASE_ANON_KEY` si les vraies valeurs manquent). La CI
(`.github/workflows/ci.yml`) rejoue exactement cela sur chaque PR.

## Autonomie

Objectif : qu'Axel n'ait rien à faire à la main qu'un agent ou la CI puisse
faire à sa place.

- **Migrations Supabase** : appliquées par la CI au merge sur `main`
  (`.github/workflows/migrate.yml`, `supabase db push`). Ne jamais demander à
  Axel de coller du SQL dans le dashboard, ne jamais lancer `psql` contre la
  base. Une migration est un NOUVEAU fichier `supabase/migrations/AAAAMMJJHHMMSS_nom.sql`,
  jamais la modification d'un fichier déjà appliqué.
- **Toute migration est idempotente** : `create table if not exists`,
  `add column if not exists`, `create index if not exists`,
  `drop policy if exists` avant `create policy`, `do $$ … if not exists … $$`
  pour les types et les rôles. Elle doit passer `npm run check:migrations` :
  DROP TABLE, DROP COLUMN, TRUNCATE, DELETE sans WHERE et GRANT/REVOKE hors du
  schéma `public` sont refusés, sauf en-tête `-- allow-destructive: <raison>`
  justifié dans la PR.
- **Agent LOCAL (VS Code)** : il lance lui-même les scripts qui lisent
  `.env.local` (`npm run eval:emails`, `scripts/reenrich.ts`,
  `scripts/enrichment-metrics.ts`…) plutôt que de demander à Axel de le faire.
  Il n'affiche JAMAIS une clé, un mot de passe ou une chaîne de connexion
  (ni dans le terminal, ni dans un fichier, ni dans un commit).
- **Agent CLOUD** : aucune clé n'est disponible, et il n'en demande pas. Il ne
  lance pas ces scripts : il écrit le code, le teste avec des mocks et des
  fixtures, et documente la commande exacte à lancer en local.
- **Jamais** de merge, **jamais** de push sur `main`. Le travail part sur une
  branche et une PR ; Axel merge.

## Parallélisme : 1 agent = 1 dossier ou 1 session cloud = 1 branche

- Deux agents LOCAUX ne travaillent jamais dans le même dossier de travail :
  chacun a son clone ou son `git worktree`, sur sa propre branche.
- Une session CLOUD travaille sur UNE branche et n'en pousse aucune autre ;
  une branche porte au plus une PR ouverte. Un sujet distinct = une autre
  session (donc une autre branche et une autre PR), jamais un empilement sur
  une PR en cours de revue.
- Avant de toucher un fichier partagé (`types.ts`, `package.json`,
  `supabase/migrations/`), partir de `main` à jour. En cas de conflit :
  merger `main` dans la branche, ne jamais réécrire l'historique d'une branche
  déjà poussée.
- Deux migrations créées en parallèle doivent avoir des horodatages
  différents : prendre l'heure réelle de création, pas une valeur ronde.
