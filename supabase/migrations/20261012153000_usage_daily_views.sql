-- ===========================================================================
-- CONSOMMATION AGRÉGÉE PAR LA BASE — le Cockpit ne relit plus l'historique
--
-- Mesure du 12/10/2026 (scripts/pilotage-chrono.ts) : sur 30 jours,
-- `api_usage` compte 12 076 lignes. PostgREST plafonnant une réponse à 1 000
-- lignes, chaque affichage du Cockpit enchaînait 14 ALLER-RETOURS pour
-- recalculer en JavaScript ce que Postgres fait en un `group by` — 1,6 s à
-- lui seul, sur 4,4 s de bloc « Pilotage ».
--
-- Deux vues, une ligne par jour, par service et par utilisateur. C'est le même
-- découpage que l'écran : le graphe affiche des barres par jour, les plafonds
-- des sommes depuis minuit ou depuis le 1er du mois.
--
-- Le jour est calculé À PARIS, comme partout dans l'app : `created_at at time
-- zone 'Europe/Paris'` suit les changements d'heure, ce qu'un décalage fixe de
-- +1 h ne ferait pas.
--
-- RLS : `security_invoker = true` fait évaluer les policies de la table SOUS
-- L'IDENTITÉ DE L'APPELANT. Sans cette option, une vue s'exécute avec les
-- droits de son propriétaire et exposerait les lignes de tous les comptes.
-- `user_id` reste en colonne pour que la policy s'applique et que l'app puisse
-- filtrer.
--
-- Migration additive : deux vues créées, aucune table ni colonne touchée,
-- aucune donnée supprimée. Les lectures ligne à ligne existantes continuent de
-- fonctionner — l'app retombe dessus si ces vues manquent.
-- ===========================================================================

create or replace view public.api_usage_daily
  with (security_invoker = true) as
select
  user_id,
  (created_at at time zone 'Europe/Paris')::date as day,
  service,
  count(*)::bigint                        as calls,
  sum(coalesce(cost, 0))::numeric(18, 6)  as eur,
  sum(coalesce(units, 0))::numeric(18, 4) as units
from public.api_usage
group by user_id, (created_at at time zone 'Europe/Paris')::date, service;

comment on view public.api_usage_daily is
  'Consommation payante agrégée par jour (Europe/Paris), service et utilisateur : calls, euros, unités. Lue par le Cockpit et par les compteurs de plafond. security_invoker : la RLS de api_usage s''applique.';

create or replace view public.free_api_calls_daily
  with (security_invoker = true) as
select
  user_id,
  (created_at at time zone 'Europe/Paris')::date as day,
  service,
  count(*)::bigint                        as calls,
  sum(coalesce(units, 0))::numeric(18, 4) as units
from public.free_api_calls
group by user_id, (created_at at time zone 'Europe/Paris')::date, service;

comment on view public.free_api_calls_daily is
  'Appels gratuits (INPI…) agrégés par jour (Europe/Paris), service et utilisateur. Coût nul par construction.';

-- Sans GRANT, PostgREST échoue en 42501 avant même d'évaluer les policies.
-- `anon` reste exclu, comme sur les tables sous-jacentes.
grant select on public.api_usage_daily to authenticated, service_role;
grant select on public.free_api_calls_daily to authenticated, service_role;

-- Pas d'index sur `(created_at at time zone 'Europe/Paris')::date` : cette
-- conversion est STABLE, pas IMMUTABLE, et Postgres refuse une expression non
-- immuable dans un index. Les index existants `(user_id, created_at desc)`
-- couvrent déjà la restriction de période, qui est ce qui coûte ; le `group by`
-- travaille ensuite sur un jeu déjà réduit.
