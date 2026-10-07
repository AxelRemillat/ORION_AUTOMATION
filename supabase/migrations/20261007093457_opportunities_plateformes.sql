-- ===========================================================================
-- PLATEFORMES FREELANCE (Upwork, Malt, ComeUp) — 07/10/2026
--
-- Upwork n'a plus de flux RSS, Malt et ComeUp n'ont pas de flux d'annonces :
-- les demandes, invitations et messages arrivent PAR E-MAIL. Un workflow n8n
-- Gmail dédié les pousse sur POST /api/opportunities/ingest-email.
--
--   opportunity_emails : un e-mail de plateforme reçu = une ligne (dédoublonnage
--                        par message_id). Rattaché à une opportunité (créée ou
--                        existante), ou « à trier » s'il n'est pas reconnu.
--   opportunities      : jalons datés du suivi (conversation, gagnée), client,
--                        devise et nature de l'enchère suggérée (Upwork : $,
--                        forfait ou horaire).
--
-- Migration additive et idempotente : une table neuve, des colonnes nullables
-- ou avec défaut. Rien n'est modifié ni supprimé ailleurs.
-- ===========================================================================

alter table public.opportunities add column if not exists client_name text;
alter table public.opportunities add column if not exists conversation_at timestamptz;
alter table public.opportunities add column if not exists won_at timestamptz;
alter table public.opportunities add column if not exists last_event_at timestamptz;
alter table public.opportunities add column if not exists suggested_currency text;
alter table public.opportunities add column if not exists suggested_hourly boolean not null default false;

create index if not exists opportunities_platform_idx on public.opportunities (user_id, platform, created_at desc);

create table if not exists public.opportunity_emails (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade default auth.uid(),
  message_id      text not null,
  platform        text,
  -- invitation · demande · commande · message · offre · gagnee · perdue · recommandation · autre
  kind            text not null default 'autre',
  from_address    text,
  subject         text,
  received_at     timestamptz,
  excerpt         text,
  external_id     text,
  opportunity_id  uuid references public.opportunities (id) on delete set null,
  -- 'a_trier' (non reconnu) · 'cree' (opportunité créée) · 'rattache' (suivi d'une opportunité) · 'trie' (classé à la main)
  status          text not null default 'a_trier',
  alerted         boolean not null default false,
  created_at      timestamptz not null default now()
);

create unique index if not exists opportunity_emails_message_uidx on public.opportunity_emails (user_id, message_id);
create index if not exists opportunity_emails_opportunity_idx on public.opportunity_emails (opportunity_id, received_at desc);
create index if not exists opportunity_emails_status_idx on public.opportunity_emails (user_id, status, created_at desc);

alter table public.opportunity_emails enable row level security;

drop policy if exists "opportunity_emails_owner" on public.opportunity_emails;
create policy "opportunity_emails_owner" on public.opportunity_emails
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update on public.opportunity_emails to authenticated, service_role;
