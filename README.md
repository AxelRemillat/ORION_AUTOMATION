# PROSPECT

Application web personnelle de prospection freelance. Mono-utilisateur.
Dépôt : `ORION_AUTOMATION` — *ORION* désigne le projet, *PROSPECT* l'application.

**Stack** : Next.js 14 (App Router, TypeScript, Tailwind) · Supabase (Postgres + Auth) · OpenAI · n8n.

---

## Démarrer

```bash
npm install
cp .env.local.example .env.local   # puis remplir les valeurs
npm run dev                        # http://localhost:3000
```

Autres scripts : `npm run build`, `npm run lint`, `npm run typecheck`.

> `.env.local` est ignoré par git — ne jamais le committer.

### Base de données

Appliquer les fichiers de `supabase/migrations/` **dans l'ordre des noms** :

- via le SQL Editor du dashboard Supabase (copier-coller), ou
- via la CLI : `supabase db push`.

| Migration | Contenu |
| --- | --- |
| `20260907000000_init.sql` | 4 tables, énumérations, index, trigger `updated_at` et **RLS par `user_id`** (chaque ligne n'est lisible et modifiable que par son propriétaire) |
| `20260907120000_prospects_email.sql` | Colonne `prospects.email` (nullable) |
| `20260908000000_orion_grants.sql` | `GRANT` DML aux rôles `authenticated` et `service_role` sur les 4 tables — **indispensable** : sans lui PostgREST refuse tout en `42501`, policies RLS ou pas |
| `20260920100000_purge_unproven_signals.sql` | Supprime les signaux web sans preuve (ancien format sans `quote` ni `url`) |
| `20260920110000_api_usage.sql` | Table `api_usage` : consommation et coût réels des APIs tierces, RLS + GRANT |
| `20260920120000_favorites.sql` | Table `favorites` : entreprises déjà enrichies mises en réserve, RLS + GRANT |
| `20260925100000_prospect_brief.sql` | Colonne `prospects.brief` : dernier brief du stratège (angle, pain, preuve, ciblage) |
| `20260925124235_trash.sql` | Corbeille : `prospects.deleted_at`, `prospects.status_before_delete`, index, table `excluded_companies` (SIREN à ne plus proposer), RLS + GRANT |

Une migration oubliée se voit tout de suite : les requêtes échouent sur une
colonne inconnue.

### Créer le compte

L'app n'a pas d'écran d'inscription : créer l'unique utilisateur depuis le
dashboard Supabase (*Authentication → Users → Add user*, email + mot de passe),
puis se connecter sur `/login`.

## Variables d'environnement

| Variable | Portée | Rôle |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + serveur | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + serveur | Clé publique (soumise à la RLS) |
| `SUPABASE_SERVICE_ROLE` | serveur | Clé admin, **ignore la RLS** — jobs et webhooks uniquement |
| `OPENAI_API_KEY` | serveur | Génération des messages |
| `OPENAI_MODEL` | serveur | Optionnel, défaut `gpt-4o-mini` — repli de tous les rôles ci-dessous |
| `OPENAI_MODEL_EXTRACT` · `OPENAI_MODEL_STRATEGIST` · `OPENAI_MODEL_WRITER` · `OPENAI_MODEL_JUDGE` | serveur | Optionnelles — modèle par rôle (`lib/ai/models.ts`). Absentes = `OPENAI_MODEL` |
| `OPENAI_REASONING_EFFORT_<ROLE>` | serveur | Optionnelle — `low`/`medium`/`high` pour un modèle de raisonnement (défaut : `medium` pour le stratège, `low` ailleurs). La température n'est alors pas envoyée |
| `OPENAI_PRICES_JSON` | serveur | Optionnelle — prix des modèles hors grille, `{"modele":{"input":1.25,"output":10}}` en $ / million de tokens |
| `PAPPERS_API_KEY` | serveur | Données légales des entreprises |
| `LINKUP_API_KEY` | serveur | Recherche web / signaux |
| `HUNTER_API_KEY` | serveur | Emails professionnels |
| `N8N_WEBHOOK_SEND_URL` | serveur | Webhook d'envoi des messages |
| `CRON_SECRET` | serveur | Secret des crons Vercel (`/api/cron/purge-trash`, purge quotidienne de la corbeille). Sans lui, la route refuse tout et la purge se fait à l'ouverture de `/corbeille` |
| `NEXT_PUBLIC_BOOKING_URL` | client + serveur | Optionnelle — lien de RDV placé dans le CTA des emails |
| `USD_EUR_RATE` | serveur | Optionnelle — conversion des services facturés en $ (défaut 0.92) |
| `LINKUP_SEARCH_USD` | serveur | Optionnelle — prix d'une recherche Linkup (défaut 0.005) |
| `PAPPERS_CREDIT_EUR` · `PAPPERS_PLAN_CREDITS` | serveur | Optionnelles — valeur d'un crédit, taille du forfait |
| `HUNTER_SEARCH_EUR` | serveur | Optionnelle — valeur d'une recherche Hunter |
| `OPENAI_MONTHLY_BUDGET_EUR` | serveur | Optionnelle — seul moyen d'estimer le restant OpenAI |

Sur Vercel : renseigner les mêmes variables dans *Settings → Environment Variables*.
Aucune configuration supplémentaire n'est nécessaire, le projet se déploie tel quel.

### Envoi des messages (n8n)

L'app n'appelle jamais Gmail directement : `POST /api/emails/send` pousse vers un
webhook n8n qui se charge de l'envoi. Le contrat attendu (déclencheur, corps de
la requête, réponse, authentification) est décrit dans [docs/n8n.md](docs/n8n.md).
Sans `N8N_WEBHOOK_SEND_URL`, tout le reste de l'app fonctionne : seul l'envoi est
indisponible.

---

## Architecture

```
app/
  (auth)/login/          Écran de connexion (public)
  (app)/                 Routes protégées : layout = sidebar + header
    recherche/  prospection/  suivi/  stats/
  auth/signout/          Route handler POST de déconnexion
  layout.tsx             Layout racine : police, thème, styles globaux
components/
  ui/                    Design system (barrel : @/components/ui)
  layout/                Coquille applicative (sidebar, header)
lib/
  supabase/              Clients navigateur / serveur / middleware
  auth.ts                getUser(), requireUser()
  openai.ts              Client OpenAI + completeText()
  constants.ts           Libellés et couleurs des statuts
  utils.ts               cn(), formatEur(), formatDate()
supabase/migrations/     SQL versionné
types.ts                 Contrat de types partagé
middleware.ts            Rafraîchit la session, protège les routes
```

### Authentification

`middleware.ts` s'exécute sur toutes les routes : il rafraîchit la session
Supabase et redirige vers `/login?next=...` tout visiteur non connecté.
Seuls `/login` et `/auth/*` sont publics. Dans un Server Component, utiliser
`requireUser()` (`lib/auth.ts`) pour récupérer l'utilisateur.

### Thème

Les couleurs sont des variables CSS (`app/globals.css`) exposées à Tailwind
comme tokens : `bg`, `surface`, `surface-2`, `border`, `fg`, `muted`, `accent`,
`success`, `warning`, `danger`, `info`, `violet`, `teal`.

**Toujours utiliser ces tokens** (`bg-surface`, `text-muted`, `border-border`),
jamais `bg-zinc-900` ou `text-white` : c'est ce qui fait fonctionner le thème
clair sans écrire de variante `dark:`. Le sombre est le défaut ; la bascule
(`<ThemeToggle />`) pose la classe `light`/`dark` sur `<html>`.

Accent : `#E8552E`.

### Design system — `@/components/ui`

`Button` · `Input` · `Label` · `Textarea` · `Select` · `Card` (+ `CardHeader`,
`CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `StatCard`) ·
`Badge` · `ProspectStatusBadge` · `DealStatusBadge` · `Table` (+ `THead`,
`TBody`, `TR`, `TH`, `TD`, `TableEmpty`) · `Modal` · `ToastProvider` /
`useToast()` · `ThemeToggle` · `Skeleton` · `EmptyState` · `PageHeader`.

`ToastProvider` est déjà monté dans `app/(app)/layout.tsx` : appeler
`useToast()` depuis n'importe quel Client Component de l'app.

---

## Contrat entre agents

Chaque agent ne modifie **que** ses dossiers.

| Zone | Propriétaire |
| --- | --- |
| `app/(auth)/**`, `app/(app)/layout.tsx`, `app/layout.tsx`, `middleware.ts` | Agent 1 (fondations) |
| `components/ui/**`, `components/layout/**` | Agent 1 |
| `lib/supabase/**`, `lib/auth.ts`, `lib/openai.ts`, `lib/utils.ts`, `lib/env.ts`, `lib/theme.ts`, `lib/constants.ts` | Agent 1 |
| `types.ts`, `supabase/migrations/**` | Agent 1 |
| `app/(app)/recherche/**`, `app/(app)/prospection/**` | Agent 2 |
| `app/(app)/suivi/**`, `app/(app)/stats/**` | Agent 3 |

Les pages des 4 sections sont livrées en **placeholder** : les remplacer
entièrement. Chaque agent peut créer librement des sous-dossiers, des
composants locaux, des Server Actions et des routes API **dans son périmètre**.

Un besoin transverse (nouveau composant `ui`, nouveau type, nouvelle table) se
demande à l'agent 1 plutôt que de dupliquer ou de modifier ses fichiers.

### Règles d'écriture

- Importer les types depuis `@/types`, jamais les redéclarer.
- Importer les composants depuis `@/components/ui` (barrel).
- Côté serveur : `createClient()` de `@/lib/supabase/server` (soumis à la RLS).
  `createAdminClient()` uniquement pour un job ou un webhook.
- Côté client : `createClient()` de `@/lib/supabase/client`.
- Ne jamais renseigner `user_id` à la main : la base le remplit via
  `default auth.uid()`, et la RLS le vérifie.
- Composants React < 150 lignes, TypeScript strict, `npm run typecheck` propre.
