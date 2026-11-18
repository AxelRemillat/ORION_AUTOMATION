# Refonte ORION, novembre 2026 : de la prospection e-mail au CRM du Web des Artisans

Lot 1 (Cowork #117, 18/11/2026) : cadrage et CRM. Branche `refonte/crm-lot1`, à valider par Axel avant fusion.

**Principe : on masque et on désactive, on n'efface rien.** Prospects, messages, brouillons, file d'envoi et
historique restent en base. La migration du lot est additive (`crm_` uniquement), aucune table existante n'est
modifiée.

## 1. Interrupteur `PROSPECTION_EMAIL_ACTIVE`

Code : `lib/prospection/pause.ts`. Tests : `npm run test:pause-prospection` (0 appel réseau mesuré).

| Valeur | Effet |
| --- | --- |
| absente, vide, `false`, autre | **pause** (défaut) |
| `true` (casse et espaces ignorés) | prospection e-mail active, comme avant la refonte |

En pause :

- **Appels payants refusés à la source**, avant tout `fetch` : Pappers (`lib/enrichment/pappers.ts`, le cache
  reste lu), Hunter (`rawHunterGet`, `contact-finder/clients.ts`), Linkup (`fetchWebResults`, `fetchPage`,
  `contact-finder webSearch`). Même chemin qu'une clé absente : les appelants savent déjà le gérer.
- **Jobs** : `createJob` refuse les 5 types (recherche par critères, signaux, préparation/entonnoir, rédaction,
  réécriture, réanalyse) ; `drainJobs` ne traite rien.
- **Tick pg_cron** (`/api/jobs/tick`, chaque minute) : répond `{ paused: true }` sans lancer les envois programmés
  (`runDueSends`), ni la préparation de 5 h (`startDueAutoRuns`), ni le drainage des jobs.
- **Routes** (HTTP 423 `{ paused: true }`) : `emails/generate`, `emails/send`, `prospects/enrich`,
  `prospects/search`, `prospects/signals`, `search/runs`.
- **Actions de l'archive** (ancien Aujourd'hui) : les 10 actions serveur refusent (`archiveEnLectureSeule`).

À savoir : le cron SQL `orion-signal-funnel-daily` (4 h et 5 h UTC) insère encore un job `search_signals` si
`funnel_settings.daily` est vrai. Ce job reste en file **sans être exécuté** (drain bloqué). Avant de remettre
le flag à `true`, vérifier la table `jobs` (ou passer `daily` à faux dans Réglages) pour ne pas relancer d'un coup
des recherches anciennes.

**Sur Vercel** : la variable n'existe pas aujourd'hui, donc la prod passe en pause dès la fusion. C'est voulu.
Pour réactiver : `PROSPECTION_EMAIL_ACTIVE=true` dans les variables Vercel, puis redéployer.

## 2. Inventaire et décisions

### Pages

| Route | Rôle avant | Décision |
| --- | --- | --- |
| `/aujourdhui` | file des mails préparés la nuit | **remplacée** par les tâches CRM du jour ; l'ancien écran est déplacé |
| `/archives/prospection-email` | (nouveau) | **ancien Aujourd'hui, en lecture seule**, lien « Archives » en haut à droite |
| `/crm`, `/crm/[id]` | (nouveau) | **garder** : CRM du Web des Artisans |
| `/opportunites` | Codeur, Upwork, ComeUp | **garder** Upwork et ComeUp ; Codeur **masqué** (revient seul pour une fiche Codeur visée par `?id=`) |
| `/reglages/*` | données, coûts, paramètres, intégrations, délivrabilité | **garder** |
| `/cockpit` | vue d'ensemble prospection | **retiré de la barre**, route gardée (lien depuis l'archive) |
| `/suivi` | pipeline prospects | **retiré de la barre**, route gardée (lien depuis l'archive) |
| `/recherche` | recherche avancée | hors barre (déjà), route gardée ; lancements refusés en pause |
| `/prospection/[id]` | fiche prospect | gardée, lecture ; rédaction et envoi refusés en pause |
| `/corbeille`, `/offre` | corbeille, page d'offre | **garder** (icônes de la barre) |
| Compta (agent4) | — | ajoutée à la barre quand sa route existera (pas de lien mort) |

Nouvelle barre : **Aujourd'hui · CRM · Opportunités · Réglages**, puis Compta quand agent4 aura livré.

### Tâches planifiées

| Tâche | Où | Décision |
| --- | --- | --- |
| `orion-jobs-tick`, chaque minute | pg_cron → `/api/jobs/tick` | **en pause** (répond tout de suite, aucun coût) |
| préparation de 5 h (lun.-ven.) | dans le tick (`startDueAutoRuns`) | **en pause** |
| relances programmées / file d'envoi | dans le tick (`runDueSends`) | **en pause** (rien ne part, la file reste en base) |
| `orion-signal-funnel-daily` 4 h-5 h UTC | pg_cron, SQL | inchangé ; job créé mais **jamais exécuté** (voir §1) |
| `purge-trash` 3 h 17 | Vercel cron | **garder** (vide la corbeille au-delà de la rétention, comportement existant) |
| veille Codeur, e-mails des plateformes | n8n → `/api/opportunities/ingest*` | **garder** (Opportunités) ; Codeur ne fait que s'accumuler, masqué |
| réponses reçues | n8n → `/api/inbound` | **garder** : une réponse d'un ancien prospect doit rester visible (badge sur « Archives ») |

### Variables d'environnement

| Variable | Usage | Décision |
| --- | --- | --- |
| `PROSPECTION_EMAIL_ACTIVE` | nouvel interrupteur | **à ne pas poser** (= pause) |
| `PAPPERS_API_KEY`, `HUNTER_API_KEY`, `LINKUP_API_KEY` | enrichissement | gardées, **inutilisées en pause** |
| `OPENAI_*` | rédaction (pause) et analyse Opportunités (gardée) | gardées |
| `OPPORTUNITIES_*`, `NTFY_TOPIC` | Opportunités, notifications | gardées |
| `N8N_WEBHOOK_SEND_URL`, `SENDING_DOMAIN`, `DKIM_SELECTOR` | envoi Gmail | gardées, **inutilisées en pause** |
| `JOBS_TICK_SECRET`, `JOBS_BASE_URL`, `CRON_SECRET` | tick et cron | gardées |
| `INBOUND_WEBHOOK_SECRET` | réponses reçues | gardée |
| `PLATEFORME_API_URL`, `PLATEFORME_API_TOKEN` | futur lien plateforme (§4) | **à créer plus tard** |
| `ORION_DEMO` | mode démo local (captures, e2e) | jamais en prod (inactif si `NODE_ENV=production`) |

### Coûts récurrents

| Service | Avant | Après le lot 1 |
| --- | --- | --- |
| Hunter (Starter, 2 000 crédits/mois) | recherche de contacts | **0 appel** ; abonnement à résilier ou garder (décision d'Axel) |
| Pappers (crédits) | données légales | **0 appel** ; le SIREN du CRM passe par l'annuaire gratuit de l'État |
| Linkup | recherche web, signaux | **0 appel** |
| OpenAI | rédaction, stratège, juge, Opportunités | ne reste que l'analyse des annonces Upwork/ComeUp (plafond `OPPORTUNITIES_DAILY_LLM_CAP`) et Codeur tant que n8n l'alimente |
| Vercel, Supabase | hébergement | inchangés (la base est partagée avec VEGA) |

Si Axel le confirme, couper le workflow n8n de veille Codeur arrêterait aussi son coût OpenAI (l'onglet est masqué).

## 3. Le CRM

Code : `app/(app)/crm`, `components/crm`, `lib/crm`. Migration `supabase/migrations/20261118154034_crm_commerces.sql`.

- **Tables** : `crm_offres` (offres paramétrables : Essentiel 590 €, Sérénité 59 €/mois, Sur-mesure dès 900 €,
  semées au premier affichage), `crm_commerces` (la fiche), `crm_evenements` (chronologie). RLS « Axel seul »
  (`user_id = auth.uid()`) avec GRANT ; **pas de DELETE accordé** : on masque (`archivee_le`), on n'efface pas.
  Testé dans un vrai Postgres (PGlite) par `npm run test:crm-rls`.
- **Fiche** : nom, métier, ville, adresse, téléphone, Instagram, fiche Google, site existant (oui/non + URL),
  SIREN (annuaire gratuit `recherche-entreprises.api.gouv.fr`), contact (prénom, rôle), canal d'origine, lien de
  maquette du Studio, notes ; offre, montant du devis, date de signature, accord de démonstration (oui/non + date).
- **Étapes** : à contacter → contacté → maquette envoyée → RDV → devis envoyé → signé → en ligne, ou perdu (motif
  obligatoire). Vue tableau (cartes sur téléphone) et kanban (glisser-déposer, ou « Déplacer vers… » au doigt).
  Chaque changement est tracé dans la chronologie.
- **Chronologie** : appel, visite, message, RDV, devis, note, avec une prochaine action datée facultative.
- **Aujourd'hui** : les prochaines actions du jour et en retard, puis les 7 jours suivants ; « Fait » note l'action
  et propose la suivante.
- **Saisie rapide** (< 30 s) : nom seul obligatoire, depuis « Nouvelle fiche » ou `/crm?nouveau=1`.
- **Recherche instantanée** (sans accents) et filtres étape / métier / ville.

### Import initial

`npm run crm:import` **simule** (lit la base, affiche le plan, n'écrit rien). `npm run crm:import -- --apply` crée :

1. **Optique des Alpes** (Guillaume Teissedre, gérant, La Mure), étape « en ligne », offre Essentiel ;
2. une fiche par prospect ayant montré un intérêt (statut répondu, en discussion ou gagné, hors corbeille),
   reliée au prospect (`prospect_id`), canal « prospection e-mail ».

Idempotent : déjà relié ou même nom dans la même ville = ignoré. À lancer **après** la fusion (la migration doit
être appliquée) ; aucun prospect n'est modifié.

## 4. Lien avec la plateforme (préparé, non branché)

Bouton « Créer l'espace client sur la plateforme » visible et **désactivé** sur la fiche. Le contrat est écrit
dans `lib/crm/plateforme.ts` : `creerClientPlateforme(donnees)` enverra `POST {PLATEFORME_API_URL}/admin/clients`
(jeton `PLATEFORME_API_TOKEN`), puis enregistrera `plateforme_client_id` sur la fiche. Tant que les deux variables
manquent, la fonction refuse proprement, sans réseau.

## 5. Mode démo local (captures et tests e2e)

`ORION_DEMO=1 npm run dev` : pas de session, CRM en mémoire (`lib/crm/memoire.ts`, fiches d'exemple marquées
comme telles), badges à zéro, aucune lecture Supabase. **Impossible en production** : `modeDemo()` exige
`NODE_ENV !== "production"`, ce qui est toujours faux sur Vercel (preview comprise).

## 6. À valider par Axel

1. La pause par défaut en prod dès la fusion (aucune variable à poser).
2. La nouvelle barre, et Cockpit / Pipeline retirés de la barre (routes gardées).
3. L'archive en lecture seule de l'ancien Aujourd'hui.
4. Codeur masqué dans Opportunités (et ses alertes retirées du badge).
5. Les étapes, canaux et offres du CRM.
6. Le périmètre de l'import (statuts répondu / en discussion / gagné), puis lancer `--apply` après la fusion.
7. Le sort des abonnements Hunter / Pappers / Linkup et du workflow n8n Codeur.
