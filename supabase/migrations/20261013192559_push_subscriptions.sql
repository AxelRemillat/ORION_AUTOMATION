-- ===========================================================================
-- Notifications sur le PC (Web Push) — Cowork #28, 13/10/2026
--
-- Un abonnement Web Push par navigateur (plusieurs appareils possibles).
-- « Désactiver » et un abonnement expiré (410) posent `disabled_at` : aucune
-- ligne n'est supprimée. Les clés VAPID vivent dans Vercel, jamais ici.
--
-- Migration additive et idempotente : une table neuve, des policies recréées.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where disabled_at is null;

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_owner" on public.push_subscriptions;
create policy "push_subscriptions_owner" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update on public.push_subscriptions to authenticated, service_role;
