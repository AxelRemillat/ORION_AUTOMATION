-- Réponses envoyées depuis ORION à un mail reçu NON rattaché à une fiche (Cowork #51).
--
-- `messages.prospect_id` est NOT NULL et référencé partout : une réponse sans
-- fiche ne peut pas y vivre. Elle a sa propre table, additive. Rien ne part
-- sans un clic d'Axel ; la garde au départ vérifie « ne plus contacter »
-- (adresse ET domaine) — lib/outbox/free-reply.ts.

create table if not exists public.inbound_replies (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  inbound_id       uuid not null references public.inbound_messages (id) on delete cascade,
  to_email         text not null,
  subject          text not null,
  body             text not null,
  -- sending → sent | failed
  status           text not null default 'sending',
  send_error       text,
  thread_id        text,
  gmail_message_id text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists inbound_replies_inbound_idx on public.inbound_replies (inbound_id, created_at desc);

alter table public.inbound_replies enable row level security;

drop policy if exists "inbound_replies_owner" on public.inbound_replies;
create policy "inbound_replies_owner" on public.inbound_replies
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.inbound_replies to authenticated, service_role;
