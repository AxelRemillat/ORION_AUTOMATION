-- ===========================================================================
-- PROSPECT — schéma initial
-- 4 tables (prospects, messages, deals, reminders) + RLS par user_id.
-- App mono-utilisateur : chaque ligne appartient à un utilisateur Supabase Auth
-- et n'est visible que par lui.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Énumérations (miroir de types.ts)
-- --------------------------------------------------------------------------
create type prospect_status as enum (
  'nouveau', 'a_contacter', 'contacte', 'relance_1', 'relance_2',
  'repondu', 'en_discussion', 'gagne', 'perdu'
);
create type prospect_source as enum ('auto', 'import');
create type message_type    as enum ('intro', 'relance_1', 'relance_2', 'note');
create type message_status  as enum ('draft', 'sent');
create type deal_status     as enum ('ouvert', 'gagne', 'perdu');

-- --------------------------------------------------------------------------
-- Trigger partagé : maintient `updated_at`
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- prospects
-- --------------------------------------------------------------------------
create table public.prospects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  company_name text not null,
  siren        text,
  website      text,
  sector       text,
  size_range   text,
  city         text,
  source       prospect_source not null default 'auto',
  signals      jsonb not null default '[]'::jsonb,
  key_figures  jsonb not null default '{}'::jsonb,
  pain_point   text,
  status       prospect_status not null default 'nouveau',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Un même SIREN ne peut pas être prospecté deux fois par le même utilisateur.
create unique index prospects_user_siren_key
  on public.prospects (user_id, siren)
  where siren is not null;

create index prospects_user_status_idx  on public.prospects (user_id, status);
create index prospects_user_created_idx on public.prospects (user_id, created_at desc);

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- messages
-- --------------------------------------------------------------------------
create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  type        message_type not null,
  subject     text,
  body        text not null,
  status      message_status not null default 'draft',
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index messages_prospect_idx    on public.messages (prospect_id, created_at desc);
create index messages_user_status_idx on public.messages (user_id, status);

-- --------------------------------------------------------------------------
-- deals
-- --------------------------------------------------------------------------
create table public.deals (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  amount_eur  numeric(12, 2),
  status      deal_status not null default 'ouvert',
  signed_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index deals_prospect_idx    on public.deals (prospect_id);
create index deals_user_status_idx on public.deals (user_id, status);

-- --------------------------------------------------------------------------
-- reminders
-- --------------------------------------------------------------------------
create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  due_at      timestamptz not null,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Sert la vue "relances à faire" : les rappels ouverts, par échéance.
create index reminders_user_due_idx on public.reminders (user_id, due_at)
  where done = false;
create index reminders_prospect_idx on public.reminders (prospect_id);

-- ===========================================================================
-- RLS — chaque table est cloisonnée par user_id
-- ===========================================================================
alter table public.prospects enable row level security;
alter table public.messages  enable row level security;
alter table public.deals     enable row level security;
alter table public.reminders enable row level security;

create policy "prospects_owner" on public.prospects
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "messages_owner" on public.messages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "deals_owner" on public.deals
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "reminders_owner" on public.reminders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
