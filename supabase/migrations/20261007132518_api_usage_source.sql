-- ===========================================================================
-- api_usage.source — QUI a consommé (Cowork #38, 07/10/2026)
--
-- Plusieurs agents et la prod partagent la même base : sans source, un
-- plafond atteint (Linkup 31/30) ne dit pas qui l'a consommé. Valeurs
-- attendues : agent1, agent2, agent3, agent4, prod, cron. Écrite par le client
-- commun (lib/usage/record.ts) depuis USAGE_SOURCE ; « prod » par défaut.
--
-- Migration additive et rejouable : une colonne nullable avec défaut, un
-- index. Les lignes existantes ne sont pas modifiées (source NULL = d'avant).
-- ===========================================================================

alter table public.api_usage add column if not exists source text default 'prod';

create index if not exists api_usage_source_created_idx
  on public.api_usage (source, created_at desc);
