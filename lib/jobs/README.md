# Travaux de fond (`lib/jobs`)

Recherches et générations de mail continuent côté serveur quand on quitte la
page ou qu'on ferme l'app. Jusqu'à 3 jobs tournent en même temps par
utilisateur ; les suivants attendent en file.

## Principe

```
écran ── POST /api/jobs ──> ligne `jobs` (queued) ──> réponse immédiate {id}
                                  │
                                  └─ waitUntil, MÊME invocation (≤ 300 s) :
                                     claim_job → étape 0 → claim → étape 1 → … → done
                                     puis les autres jobs en file

relèves, si l'invocation n'a pas fini (budget, coupure) :
  1. POST /api/jobs/tick (JOBS_TICK_SECRET)   ← fin de budget
  2. pg_cron chaque minute → /api/jobs/tick   ← navigateur fermé
  3. GET /api/jobs?active=1 (navbar, 3 s)     ← app ouverte, sans secret
```

L'écran ne pilote plus rien : il crée le job puis SUIT la base (la ligne
`search_runs` pour un scan, `GET /api/jobs/:id` pour un mail). Quitter la page
ou fermer l'app n'arrête pas le travail.

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

- **Heartbeat du scan** : pendant un scan, la ligne `search_runs` est réécrite
  toutes les 20 s. L'écran juge un scan « interrompu » après 90 s de silence ;
  un long lot Linkup ou une vague de fiches Pappers suffisait à faire
  disparaître l'indicateur alors que le scan tournait encore. Un scan porté
  par un job en file n'est pas non plus déclaré mort.

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

## Envois programmés (`lib/outbox`)

Un brouillon programmé n'est pas un job : c'est une ligne `messages` en
`send_status = scheduled` avec `scheduled_at` et `scheduled_to`. Le tick du
cron (`{"fanout":3}`) appelle `runDueSends` : chaque mail échu passe
`scheduled → sending` par une mise à jour conditionnelle (deux ticks ne
prennent jamais la même ligne), puis part par `lib/outbox/send.ts` — le même
chemin que `/api/emails/send` (corbeille, « ne plus contacter », plafond du
jour, webhook n8n, statut, relance). Échec passager : reprise à +5 puis +15 min,
puis `failed`. Un `sending` de plus de 15 min est déclaré échoué, jamais
renvoyé. La migration `20260927124154_messages_outbox.sql` élargit la condition
du cron aux mails échus.

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

Sans aucun de ces réglages, une recherche ou un mail va déjà au bout côté
serveur (exécution en `waitUntil` dès la création). Ils servent aux relèves :
un job coupé par la plateforme, ou plus long que 300 s, alors que l'app est
fermée.

1. **Vercel → Settings → Environment Variables** (Production) :
   - `SUPABASE_SERVICE_ROLE` : **indispensable** — sans lui, aucun job ne
     tourne (le client service_role exécute les étapes). Déjà requis par la
     purge de la corbeille.
   - `JOBS_TICK_SECRET` : `openssl rand -hex 32`. Sans lui, pas de relève
     par /api/jobs/tick (ni chaîne, ni pg_cron).
   - `JOBS_BASE_URL` (optionnel) : URL publique de l'app, si l'origine de la
     requête ne convient pas.
   - Redéployer après avoir ajouté une variable (Deployments → Redeploy).
2. **Supabase → Database → Extensions** : activer `pg_cron` et `pg_net`. Les
   migrations `…_jobs.sql` et `…_jobs_cron_retry.sql` programment le cron si
   les extensions sont là ; si elles ont été activées APRÈS, il faudra une
   nouvelle migration du même bloc (une migration appliquée n'est jamais
   rejouée). Vérifier dans **Integrations → Cron** : tâche `orion-jobs-tick`,
   `* * * * *`.
3. **Supabase → Integrations → Vault** : deux secrets,
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
