-- ===========================================================================
-- Notifications téléphone (ntfy) — 06/10/2026
--
-- Axel ne consulte pas Gmail : ORION le prévient sur son téléphone (réponse
-- d'un prospect, challenge anti-spam à valider, envoi échoué).
--
--   notification_prefs : un interrupteur par type (tout activé par défaut).
--   notification_log   : anti-doublon — UNE notification par message, la clé
--                        primaire refuse la seconde (23505).
--
-- Migration additive et idempotente : deux tables neuves, des policies
-- recréées. Rien n'est modifié ni supprimé ailleurs.
-- ===========================================================================

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  reply boolean not null default true,
  antispam boolean not null default true,
  send_failed boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists "notification_prefs_owner" on public.notification_prefs;
create policy "notification_prefs_owner" on public.notification_prefs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update on public.notification_prefs to authenticated, service_role;

create table if not exists public.notification_log (
  -- « reply:<id du mail reçu> », « antispam:<id> », « send_failed:<id du message> »
  key text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  kind text not null,
  created_at timestamptz not null default now()
);

create index if not exists notification_log_user_idx
  on public.notification_log (user_id, created_at desc);

alter table public.notification_log enable row level security;

drop policy if exists "notification_log_owner" on public.notification_log;
create policy "notification_log_owner" on public.notification_log
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert on public.notification_log to authenticated, service_role;
