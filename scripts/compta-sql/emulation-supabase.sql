-- Émulation minimale de Supabase pour tester les migrations compta sur un Postgres nu (local ou service CI) :
-- schéma auth (users, uid() lu dans request.jwt.claim.sub), rôles, schéma storage (buckets, objects, foldername).
-- JAMAIS contre la base de production.
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema auth, storage to authenticated, anon;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function auth.uid() to authenticated, anon;
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222') on conflict do nothing;
-- Dépendances de la migration crm_ (#208, déjà sur main) que la compta référence (compta_clients.crm_ref) :
-- table prospects réduite à sa clé et déclencheur updated_at (définition de 20260907000000_init.sql).
create table if not exists public.prospects (id uuid primary key default gen_random_uuid());
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
