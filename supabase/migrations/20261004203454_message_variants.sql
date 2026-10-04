-- ===========================================================================
-- Variantes d'un mail, pour mesurer ce qui marche (réponses, rebonds, « stop »)
-- attribut par attribut : type d'accroche, pain, démo, appel à l'action, style
-- d'objet, premier mot, longueur.
--
-- Une ligne par mail (message_id unique), écrite par le générateur via
-- recordMessageVariant() (lib/variants/record.ts). Lecture : Réglages › Données.
--
-- Migration additive et idempotente : table nouvelle uniquement.
-- ===========================================================================

create table if not exists public.message_variants (
  message_id    uuid primary key references public.messages (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  hook_type     text,
  pain          text,
  demo          text,
  cta           text,
  subject_style text,
  opening_word  text,
  length        integer,
  created_at    timestamptz not null default now()
);

create index if not exists message_variants_user_idx on public.message_variants (user_id, created_at desc);

alter table public.message_variants enable row level security;

drop policy if exists "message_variants_owner" on public.message_variants;
create policy "message_variants_owner" on public.message_variants
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update on public.message_variants to authenticated, service_role;
