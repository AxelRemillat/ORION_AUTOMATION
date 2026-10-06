-- ===========================================================================
-- Verrou de rédaction — quota « Avec » atomique (Cowork #31) — 06/10/2026
--
-- Jusqu'à trois jobs de rédaction tournent en parallèle par utilisateur : deux
-- pouvaient compter les ouvertures du jour au même moment et s'ouvrir tous les
-- deux sur « Avec ». Le job qui tient ce verrou compte et peut ouvrir sur
-- « Avec » ; les autres rédigent sans (lib/emails/quality/avec-lock.ts).
--
--   generation_locks         : une ligne par (utilisateur, nom de verrou).
--   try_generation_lock      : prise ATOMIQUE (upsert conditionnel), non bloquante.
--   release_generation_lock  : relâche (échéance ramenée à maintenant ; rien
--                              n'est supprimé).
--
-- Migration additive et idempotente : une table neuve, deux fonctions.
-- Réservée au service_role (les jobs) : aucune policy pour authenticated.
-- ===========================================================================

create table if not exists public.generation_locks (
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  holder text not null,
  locked_until timestamptz not null,
  primary key (user_id, name)
);

alter table public.generation_locks enable row level security;

grant select, insert, update on public.generation_locks to service_role;

create or replace function public.try_generation_lock(p_user uuid, p_name text, p_holder text, p_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  got boolean;
begin
  insert into public.generation_locks as l (user_id, name, holder, locked_until)
  values (p_user, p_name, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (user_id, name) do update
    set holder = excluded.holder,
        locked_until = excluded.locked_until
    where l.locked_until < now() or l.holder = excluded.holder
  returning true into got;
  return coalesce(got, false);
end;
$$;

create or replace function public.release_generation_lock(p_user uuid, p_name text, p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.generation_locks
  set locked_until = now()
  where user_id = p_user and name = p_name and holder = p_holder;
$$;

revoke execute on function public.try_generation_lock(uuid, text, text, int) from public;
revoke execute on function public.try_generation_lock(uuid, text, text, int) from anon, authenticated;
grant execute on function public.try_generation_lock(uuid, text, text, int) to service_role;

revoke execute on function public.release_generation_lock(uuid, text, text) from public;
revoke execute on function public.release_generation_lock(uuid, text, text) from anon, authenticated;
grant execute on function public.release_generation_lock(uuid, text, text) to service_role;
