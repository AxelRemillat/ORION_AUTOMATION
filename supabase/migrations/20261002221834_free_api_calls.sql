-- ===========================================================================
-- Appels aux API GRATUITES (INPI…), pour le graphe « Consommation » du Cockpit.
--
-- `api_usage` ne peut pas les accueillir : sa contrainte CHECK limite `service`
-- aux quatre fournisseurs payants, et l'élargir supposerait de supprimer puis
-- recréer la contrainte. On ajoute donc une TABLE NOUVELLE, sans coût.
--
-- Migration additive et idempotente : nouvelle table uniquement, aucune table
-- existante touchée, aucune ligne réécrite.
-- ===========================================================================

create table if not exists public.free_api_calls (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  service     text not null,
  operation   text not null,
  units       numeric(14, 4) not null default 1,
  created_at  timestamptz not null default now()
);

create index if not exists free_api_calls_user_created_idx
  on public.free_api_calls (user_id, created_at desc);

alter table public.free_api_calls enable row level security;

drop policy if exists "free_api_calls_owner" on public.free_api_calls;
create policy "free_api_calls_owner" on public.free_api_calls
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert on public.free_api_calls to authenticated, service_role;
