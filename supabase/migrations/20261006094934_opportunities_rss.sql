-- ===========================================================================
-- VEILLE CODEUR AUTOMATIQUE — items reçus du flux RSS officiel de Codeur via un
-- workflow n8n dédié (POST /api/opportunities/ingest). Rien n'est lu sur les
-- pages Codeur : seules les données du flux (extrait de ~300 caractères).
--
-- Migration additive et idempotente : colonnes nullables + un index unique
-- partiel pour l'idempotence (une annonce = une ligne).
-- ===========================================================================

alter table public.opportunities add column if not exists source text not null default 'manuel';
alter table public.opportunities add column if not exists external_id text;
alter table public.opportunities add column if not exists categories jsonb;
alter table public.opportunities add column if not exists published_at timestamptz;
alter table public.opportunities add column if not exists description_truncated boolean not null default false;
-- 'ok' analysée · 'pending' en cours · 'a_analyser' plafond du jour atteint · 'filtre' écartée sans LLM
alter table public.opportunities add column if not exists analysis_state text;
alter table public.opportunities add column if not exists filter_reason text;
alter table public.opportunities add column if not exists seen_at timestamptz;
alter table public.opportunities add column if not exists proposal_on_excerpt boolean not null default false;
alter table public.opportunities add column if not exists suggested_amount_eur numeric;
alter table public.opportunities add column if not exists suggested_delay_days integer;

create unique index if not exists opportunities_external_uidx
  on public.opportunities (user_id, platform, external_id)
  where external_id is not null;

create index if not exists opportunities_alerts_idx on public.opportunities (user_id, fit_score, seen_at);
