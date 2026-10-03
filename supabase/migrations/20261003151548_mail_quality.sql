-- ===========================================================================
-- Qualité des mails (03/10/2026) : note du juge, raison « À revoir », drapeau
-- « modifié à la main », et HISTORIQUE des versions d'un brouillon.
--
-- - messages.quality_score  : note /10 du juge (NULL = brouillon d'avant) ;
-- - messages.quality_reason : pourquoi il est « À revoir » (NULL = envoyable) ;
-- - messages.edited_by_hand : un brouillon retouché par Axel n'est plus jamais
--   régénéré automatiquement (défaut false, aucune ligne réécrite) ;
-- - message_versions : chaque régénération y range l'ancienne version AVANT de
--   la remplacer — aucun écrasement définitif.
--
-- Additive et idempotente : colonnes nullables ou avec défaut, nouvelle table,
-- RLS + GRANT dans la même migration. Aucun drop, aucun update de lignes.
-- ===========================================================================
alter table public.messages add column if not exists quality_score numeric(3, 1);
alter table public.messages add column if not exists quality_reason text;
alter table public.messages add column if not exists edited_by_hand boolean not null default false;

create table if not exists public.message_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  message_id uuid references public.messages (id) on delete set null,
  subject text,
  body text not null,
  quality_score numeric(3, 1),
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists message_versions_message_idx on public.message_versions (message_id, created_at desc);

alter table public.message_versions enable row level security;

drop policy if exists message_versions_owner on public.message_versions;
create policy message_versions_owner on public.message_versions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert on public.message_versions to authenticated;
grant select, insert, update, delete on public.message_versions to service_role;
