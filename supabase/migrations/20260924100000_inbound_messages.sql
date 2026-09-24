-- ===========================================================================
-- Boîte de réception intelligente — emails entrants triés par n8n
--
-- Table dédiée plutôt qu'une extension de `messages` : un email entrant peut
-- ne correspondre à AUCUN prospect connu (`prospect_id` nullable), alors que
-- `messages.prospect_id` est NOT NULL et référencé partout. Séparer évite de
-- relâcher cette contrainte et de fragiliser l'envoi existant.
--
-- Confidentialité : seuls les emails que n8n a classés « prospect-related »
-- arrivent ici. Le filtrage est fait EN AMONT, côté workflow — l'app n'ingère
-- jamais la boîte complète. Voir docs/n8n-inbound.md.
--
-- Migration additive. `ALTER TYPE ... ADD VALUE` ne passe pas dans une
-- transaction sur les anciennes versions de Postgres : appliquer ce fichier
-- tel quel via psql, sans l'envelopper dans un BEGIN/COMMIT.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Un message sortant peut désormais appartenir à un fil de discussion
-- --------------------------------------------------------------------------
alter table public.messages
  add column if not exists thread_id text;

comment on column public.messages.thread_id is
  'Identifiant de fil Gmail, pour répondre dans la même conversation.';

create index if not exists messages_thread_idx
  on public.messages (thread_id)
  where thread_id is not null;

-- --------------------------------------------------------------------------
-- 2. Nouveau type de message : la réponse à un entrant
-- --------------------------------------------------------------------------
alter type message_type add value if not exists 'reponse';

-- --------------------------------------------------------------------------
-- 3. Catégories attribuées par le classifieur n8n
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'inbound_category') then
    create type inbound_category as enum ('reponse', 'question', 'relance', 'refus', 'autre');
  end if;
end
$$;

-- --------------------------------------------------------------------------
-- 4. Les emails entrants
-- --------------------------------------------------------------------------
create table if not exists public.inbound_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Nullable : un expéditeur inconnu est conservé et affiché tel quel.
  prospect_id uuid references public.prospects (id) on delete set null,
  from_email  text not null,
  subject     text,
  body        text not null,
  category    inbound_category not null default 'autre',
  /** Fil Gmail, pour répondre dans la même conversation. */
  thread_id   text,
  received_at timestamptz not null default now(),
  /** Passe à vrai quand une réponse a été envoyée depuis le Cockpit. */
  handled     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Le même email rejoué par n8n ne doit pas créer de doublon.
create unique index if not exists inbound_messages_dedupe_key
  on public.inbound_messages (user_id, from_email, received_at, coalesce(thread_id, ''));

create index if not exists inbound_messages_pending_idx
  on public.inbound_messages (user_id, received_at desc)
  where handled = false;

create index if not exists inbound_messages_prospect_idx
  on public.inbound_messages (prospect_id, received_at desc);

-- --------------------------------------------------------------------------
-- 5. RLS — cloisonnement par user_id, comme les autres tables
-- --------------------------------------------------------------------------
alter table public.inbound_messages enable row level security;

drop policy if exists "inbound_messages_owner" on public.inbound_messages;
create policy "inbound_messages_owner" on public.inbound_messages
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- 6. Privilèges
--
-- Sans GRANT, la RLS ne sert à rien : PostgREST échoue en 42501 avant même
-- d'évaluer les policies. `anon` reste exclu — aucun accès anonyme.
-- `service_role` est requis : le webhook n8n écrit hors session.
-- --------------------------------------------------------------------------
grant select, insert, update, delete on public.inbound_messages to authenticated, service_role;
