-- ===========================================================================
-- favorites — stock d'entreprises deja enrichies, mises de cote
--
-- Raison d'etre : economiser des credits. Une entreprise reperee pendant une
-- recherche a deja coute un appel Pappers et une recherche Linkup. La mettre
-- en favori conserve l'INSTANTANE complet de l'enrichissement (donnees,
-- signaux avec leurs preuves, chiffres cles) pour pouvoir la prospecter plus
-- tard sans redepenser un centime.
--
-- Volontairement distinct de `prospects` : un favori est une piste en reserve,
-- pas encore un prospect suivi. Le passage de l'un a l'autre est explicite.
--
-- Migration additive : nouvelle table uniquement.
-- ===========================================================================

create table if not exists public.favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  company_name text not null,
  siren        text,
  website      text,
  sector       text,
  city         text,
  -- Instantane de l'entreprise enrichie, au format `EnrichedCompany`.
  -- Rejoue tel quel pour creer un prospect : zero appel externe.
  company      jsonb not null,
  created_at   timestamptz not null default now()
);

-- Un meme SIREN ne peut pas etre mis deux fois en favori par le meme compte.
create unique index if not exists favorites_user_siren_key
  on public.favorites (user_id, siren)
  where siren is not null;

create index if not exists favorites_user_created_idx
  on public.favorites (user_id, created_at desc);

alter table public.favorites enable row level security;

create policy "favorites_owner" on public.favorites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.favorites to authenticated, service_role;
