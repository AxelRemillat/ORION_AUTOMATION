-- ===========================================================================
-- Corbeille des prospects, rétention 14 jours
--
-- Un prospect mis à la corbeille garde toutes ses données : `deleted_at`
-- le masque partout (helper lib/trash/scope.ts), `status_before_delete`
-- permet de le restaurer exactement. Au-delà de 14 jours, la purge
-- (/api/cron/purge-trash) le supprime avec ses données liées, et son SIREN
-- entre dans `excluded_companies` pour que la recherche ne le repropose pas.
--
-- Migration additive et idempotente : deux colonnes nullables, un index, une
-- table. Rien n'est supprimé ni réécrit.
-- ===========================================================================

alter table public.prospects add column if not exists deleted_at timestamptz;
alter table public.prospects add column if not exists status_before_delete text;

-- Les deux lectures fréquentes : « mes prospects vivants » et « ma corbeille ».
create index if not exists prospects_user_deleted_idx
  on public.prospects (user_id, deleted_at);

-- SIREN à ne plus proposer dans la recherche, par compte.
create table if not exists public.excluded_companies (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  siren      text not null,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (user_id, siren)
);

alter table public.excluded_companies enable row level security;

drop policy if exists "excluded_companies_owner" on public.excluded_companies;
create policy "excluded_companies_owner" on public.excluded_companies
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.excluded_companies to authenticated, service_role;
