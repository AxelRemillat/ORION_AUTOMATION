-- Test RLS du CRM (Cowork #117), sur un Postgres JETABLE (jamais la base Supabase de prod).
-- Lancé par scripts/crm-rls.test.ts : simulation minimale de Supabase, migration réelle, puis assertions.
\set ON_ERROR_STOP on

-- --- Simulation minimale de Supabase -----------------------------------------
drop schema if exists auth cascade;
drop table if exists public.crm_evenements, public.crm_commerces, public.crm_offres, public.prospects cascade;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;
grant usage on schema public, auth to authenticated, service_role, anon;
grant execute on function auth.uid() to authenticated, service_role, anon;
create or replace function public.set_updated_at() returns trigger language plpgsql as
  $$ begin new.updated_at = now(); return new; end $$;
create table public.prospects (id uuid primary key default gen_random_uuid(), user_id uuid, company_name text);

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

-- --- Migration réelle ---------------------------------------------------------
\ir ../supabase/migrations/20261118154034_crm_commerces.sql
-- Idempotence : la rejouer ne doit rien casser.
\ir ../supabase/migrations/20261118154034_crm_commerces.sql

-- --- Axel (A) crée une fiche et un événement ------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into public.crm_offres (libelle) values ('Essentiel');
insert into public.crm_commerces (id, nom, ville, etape) values ('11111111-1111-1111-1111-111111111111', 'Optique des Alpes', 'La Mure', 'en_ligne');
insert into public.crm_evenements (commerce_id, type, contenu) values ('11111111-1111-1111-1111-111111111111', 'note', 'Client signé');
do $$ begin
  if (select count(*) from public.crm_commerces) <> 1 then raise exception 'A doit voir sa fiche'; end if;
  if (select user_id from public.crm_commerces limit 1) <> '00000000-0000-0000-0000-00000000000a' then raise exception 'user_id par défaut = auth.uid()'; end if;
end $$;

-- --- Un autre utilisateur (B) ne voit rien, ne modifie rien ---------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare n int; begin
  if (select count(*) from public.crm_commerces) <> 0 then raise exception 'RLS : B voit les fiches de A'; end if;
  if (select count(*) from public.crm_evenements) <> 0 then raise exception 'RLS : B voit la chronologie de A'; end if;
  if (select count(*) from public.crm_offres) <> 0 then raise exception 'RLS : B voit les offres de A'; end if;
  update public.crm_commerces set nom = 'piraté' where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'RLS : B modifie la fiche de A'; end if;
end $$;
-- B ne peut pas rattacher un événement à la fiche de A.
do $$ begin
  begin
    insert into public.crm_evenements (commerce_id, type, contenu) values ('11111111-1111-1111-1111-111111111111', 'note', 'intrus');
    raise exception 'RLS : B a écrit dans la chronologie de A';
  exception when insufficient_privilege then null; -- refus attendu (42501)
  end;
end $$;
-- B ne peut pas créer une ligne au nom de A.
do $$ begin
  begin
    insert into public.crm_commerces (nom, user_id) values ('Faux', '00000000-0000-0000-0000-00000000000a');
    raise exception 'RLS : B a créé une fiche au nom de A';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --- Pas de DELETE : on masque, on n'efface pas ---------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  begin
    delete from public.crm_commerces;
    raise exception 'DELETE ne doit pas être accordé';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --- Anonyme : aucun accès -------------------------------------------------------
reset role;
set role anon;
do $$ begin
  begin
    perform count(*) from public.crm_commerces;
    raise exception 'anon ne doit pas lire le CRM';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- --- Contraintes : étape et canal limités à la liste ------------------------------
do $$ begin
  begin
    insert into public.crm_commerces (user_id, nom, etape) values ('00000000-0000-0000-0000-00000000000a', 'X', 'inconnue');
    raise exception 'étape hors liste acceptée';
  exception when check_violation then null;
  end;
end $$;

select 'CRM RLS OK' as resultat;
