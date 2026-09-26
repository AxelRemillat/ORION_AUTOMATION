# Travaux de fond (`lib/jobs`)

Recherches et générations de mail continuent côté serveur quand on quitte la
page ou qu'on ferme l'app. Jusqu'à 3 jobs tournent en même temps par
utilisateur ; les suivants attendent en file.

## Principe

```
POST /api/jobs ─┐                      ┌─> étape 0 ─> étape 1 ─> … ─> done
route historique ┼─> ligne `jobs` ─────┤    (chaque étape : claim_job → exécute → commit)
                 │   (queued)          └─ chaîne : chaque étape déclenche /api/jobs/tick
pg_cron (1 min) ─┘                        filet : pg_cron relance tout job prenable
```

- **Étapes idempotentes** : chaque étape lit son point de reprise dans
  `jobs.state`, écrit ses résultats en base, puis rend ce qui doit être fusionné.
  Rejouée après une coupure, elle repart du même point.
- **Verrou** : `claim_job()` (SQL, `FOR UPDATE SKIP LOCKED` + verrou consultatif)
  pose un bail `locked_until` de 315 s, plus long que la durée max d'une
  fonction (300 s). Bail expiré = fonction morte = job repris.
- **Reprises** : 1 tentative + 2 reprises par étape, puis `failed` avec une
  erreur lisible (`Échec après 3 tentatives : …`). Les erreurs qu'une reprise
  ne corrige pas (prospect introuvable, clé absente, zone inconnue) échouent
  tout de suite (`JobError(message, false)`).
- **Annulation** : `POST /api/jobs/:id/cancel` pose le statut ; l'étape le relit
  entre deux lots et sa fin d'étape (conditionnée à `running`) ne peut plus le
  ressusciter.
- **Limiteurs** : les étapes appellent les mêmes fonctions que les routes
  d'avant (`lib/enrichment`, `lib/signals`) : leurs limiteurs de débit et
  plafonds de coût s'appliquent tels quels.

- **Sans session** : un tick n'a pas de cookie. Les étapes tournent avec le
  client service_role et filtrent explicitement sur `user_id` là où elles
  écrivent ; le coût (`api_usage`) est imputé via `ORION_SCRIPT_USER_ID`, le
  mécanisme déjà prévu pour les scripts. Quelques lectures partagées
  (`knownSirens`, secteurs exclus) ne filtrent pas l'utilisateur : sans effet
  tant que l'app est mono-utilisateur.
- **Middleware** : `/api/jobs/tick` est une route machine (pas de redirection
  vers `/login`), protégée par son propre secret.

## Types et étapes

| Type | Étapes | Résultat |
| --- | --- | --- |
| `search_criteria` | préparation `search_runs` → scan complet | `result.runId` (entreprises dans `search_runs.results`) |
| `search_signals` | préparation `search_runs` → recherche complète | `result.runId` |
| `email_generate` | contact (Hunter) → brief (stratège) → rédaction + juge | `result.messageId` (brouillon), `prospectIds` |
| `email_rewrite` | contact (repris du client) → brief revalidé → rédaction | idem |
| `reanalyze` | enrichissement complet de la fiche | `result.prospectIds` |

**Limite connue** : le scan (`searchAndEnrich`, `searchBySignals`) et
`enrichCompany` sont d'un seul tenant dans `lib/enrichment` / `lib/signals`.
Leur étape dure donc autant qu'eux (jusqu'à 300 s pour un gros scan), au lieu
des 40 s visées. Une reprise reste économe : chaque lot scanné est journalisé
dans `scan_history`, qu'une nouvelle tentative exclut. Découper le scan page par
page demande d'exposer sa boucle dans `lib/enrichment` (chantier séparé).

## Routes

| Route | Rôle |
| --- | --- |
| `POST /api/jobs` `{type, target, params}` | crée le job → `{id}` (201), déclenche un tick |
| `GET /api/jobs?active=1` | en file / en cours + terminés non vus ; relance la chaîne si un job attend |
| `GET /api/jobs/:id` | le job |
| `POST /api/jobs/:id/cancel` | annule (et arrête la ligne `search_runs` liée) |
| `POST /api/jobs/:id/seen` | le résultat a été montré |
| `POST /api/jobs/tick` | `Bearer JOBS_TICK_SECRET` ; `{jobId?}` une étape, `{fanout: n}` n ticks |

Les routes historiques (`/api/prospects/search`, `/api/prospects/signals`,
`/api/emails/generate`) créent un job puis le pilotent elles-mêmes : les écrans
actuels reçoivent la même réponse qu'avant. En-tête `X-Job-Id` en plus. Si
trois jobs tournent déjà : `409 {error, jobId}`, le job part seul plus tard.

## Durée des fonctions (Vercel)

Plan Hobby avec Fluid compute : 300 s par défaut **et** au maximum. Toutes les
routes qui exécutent des étapes déclarent `maxDuration = 300`.

## À poser à la main (une fois)

1. **Vercel → Settings → Environment Variables** (Production) :
   - `JOBS_TICK_SECRET` : `openssl rand -hex 32`. Sans lui, la chaîne de ticks
     est coupée (les routes historiques marchent quand même).
   - `SUPABASE_SERVICE_ROLE` : déjà requis par la purge de la corbeille.
   - `JOBS_BASE_URL` (optionnel) : URL publique de l'app, si l'origine de la
     requête ne convient pas.
2. **Supabase → Database → Extensions** : activer `pg_cron` et `pg_net`, puis
   relancer le workflow « Migrations Supabase » (ou attendre la prochaine
   migration : la programmation du cron est idempotente).
3. **Supabase → Project Settings → Vault** (Integrations → Vault) : deux secrets,
   - `orion_app_url` = l'URL de prod (ex. `https://orion.vercel.app`),
   - `jobs_tick_secret` = la même valeur que `JOBS_TICK_SECRET` sur Vercel.

   Tant qu'ils manquent, le cron tourne à vide sans rien appeler.

## Alternative sans pg_cron : n8n

Workflow n8n planifié :

- **Schedule Trigger** : toutes les minutes ;
- **HTTP Request** : `POST https://<app>/api/jobs/tick`, en-tête
  `Authorization: Bearer <JOBS_TICK_SECRET>` (credential « Header Auth »),
  corps JSON `{"fanout":3}`, timeout 10 s.

Le tick ne fait rien s'il n'y a aucun job prenable. Même sans l'un ni l'autre,
`GET /api/jobs?active=1` relance la chaîne tant que l'app est ouverte.

## Tests

`npm run test:jobs` (mocks, sans base). La fonction `claim_job` et la commande
du cron ont en plus été éprouvées sur un Postgres 16 local (stubs `auth`,
`vault`, `net`) : limite de 3, reprise d'un bail expiré, 10 prises simultanées
→ 3 jobs `running` exactement, `authenticated` refusé.
