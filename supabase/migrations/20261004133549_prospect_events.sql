-- ===========================================================================
-- Historique d'une fiche prospect : événements que rien n'enregistrait encore
-- (changement de statut, « ne plus contacter », vérification d'opposition,
-- notes manuelles). Mails, réponses, relances, signaux et affaires restent lus
-- dans leurs tables : rien n'est recopié ici.
--
-- Générique par construction : `channel` (orion, email, linkedin, malt…) et
-- `kind` (status, dnc, opposition, note…) — LinkedIn et Malt s'y brancheront
-- sans nouvelle migration.
--
-- Migration additive et idempotente : table nouvelle uniquement.
-- ===========================================================================

create table if not exists public.prospect_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  channel     text not null default 'orion',
  kind        text not null,
  at          timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists prospect_events_prospect_at_idx
  on public.prospect_events (prospect_id, at desc);

alter table public.prospect_events enable row level security;

drop policy if exists "prospect_events_owner" on public.prospect_events;
create policy "prospect_events_owner" on public.prospect_events
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert on public.prospect_events to authenticated, service_role;
