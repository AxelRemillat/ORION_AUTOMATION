-- ===========================================================================
-- action_states — ce que l'utilisateur a deja traite ou repousse
--
-- La file d'actions du Cockpit est DERIVEE des tables metier : elle se
-- recalcule a chaque chargement depuis prospects, messages, reminders et
-- inbound_messages. C'est voulu — une action disparait toute seule quand
-- l'evenement reel a lieu (relance soldee, brouillon envoye), sans qu'on ait
-- a synchroniser quoi que ce soit.
--
-- Restent deux decisions que rien dans le metier ne porte : « j'ai traite ca
-- autrement » et « pas aujourd'hui ». C'est le seul objet de cette table.
--
--   done     : l'action est ecartee definitivement.
--   snoozed  : elle est masquee jusqu'a `snooze_until` (le lendemain matin),
--              puis revient d'elle-meme dans la file.
--
-- `action_id` est l'identifiant stable calcule par _lib/queue.ts
-- (ex : "relance-<uuid>", "brouillon-<uuid>") : une action qui reapparait
-- retrouve donc son etat.
--
-- Migration additive : nouvelle table uniquement.
-- ===========================================================================

create table if not exists public.action_states (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  action_id    text not null,
  state        text not null check (state in ('done', 'snoozed')),
  -- Renseigne uniquement pour `snoozed`.
  snooze_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Une seule decision courante par action : l'ecriture se fait en upsert.
create unique index if not exists action_states_user_action_key
  on public.action_states (user_id, action_id);

create index if not exists action_states_user_state_idx
  on public.action_states (user_id, state);

create trigger action_states_set_updated_at
  before update on public.action_states
  for each row execute function public.set_updated_at();

alter table public.action_states enable row level security;

create policy "action_states_owner" on public.action_states
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.action_states to authenticated, service_role;
