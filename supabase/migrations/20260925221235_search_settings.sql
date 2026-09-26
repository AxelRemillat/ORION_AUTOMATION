-- ===========================================================================
-- Reglages de recherche, par utilisateur
--
-- Un seul reglage pour l'instant : la liste des secteurs exclus. Elle ne peut
-- pas vivre dans le code — c'est un jugement commercial qui evolue, pas une
-- regle technique. Axel doit pouvoir retirer « auto-ecoles » le jour ou il
-- decide d'en demarcher une, sans qu'un agent redeploie.
--
-- Une ligne par utilisateur, `user_id` en cle primaire : il n'y a jamais deux
-- jeux de reglages pour la meme personne, et cela rend l'upsert trivial.
--
-- `excluded_sectors` est un tableau de PREFIXES NAF, pas de codes complets :
-- « 8553Z » vise les auto-ecoles, « 85 » viserait tout l'enseignement. Le
-- filtrage par prefixe est fait cote application (lib/signals/targeting.ts).
--
-- Migration additive et idempotente.
-- ===========================================================================

create table if not exists public.search_settings (
  user_id           uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  /** Prefixes NAF ecartes des deux modes de recherche. */
  excluded_sectors  text[] not null default array['8553Z', '7120A']::text[],
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Maintien de `updated_at`, comme sur les autres tables.
drop trigger if exists search_settings_set_updated_at on public.search_settings;
create trigger search_settings_set_updated_at
  before update on public.search_settings
  for each row execute function public.set_updated_at();

alter table public.search_settings enable row level security;

drop policy if exists "search_settings_owner" on public.search_settings;
create policy "search_settings_owner" on public.search_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la policy ne sert a rien : PostgREST echoue en 42501 avant meme
-- de l'evaluer. `anon` reste exclu.
grant select, insert, update, delete on public.search_settings to authenticated, service_role;
