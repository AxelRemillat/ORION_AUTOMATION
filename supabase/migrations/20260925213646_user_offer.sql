-- ===========================================================================
-- user_offer — ce qu'Axel vend, et comment il signe
--
-- Jusqu'ici, la signature, les preuves et la façon de se présenter vivaient
-- en dur dans `lib/persona.ts`. Conséquence en production : les mails ne
-- disaient ni qui écrivait, ni ce qui était concrètement proposé, et corriger
-- une phrase de bio demandait un déploiement.
--
-- Une ligne par utilisateur. Les preuves sont un tableau JSON plutôt qu'une
-- table dédiée : elles se lisent et s'écrivent toujours ensemble, jamais
-- séparément, et l'ordre compte pour l'affichage.
--
-- Migration additive et idempotente : une table, un index, des policies
-- recréées. Rien n'est supprimé ni réécrit.
-- ===========================================================================

create table if not exists public.user_offer (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),

  -- --- Signature ----------------------------------------------------------
  full_name     text,
  title         text,
  portfolio_url text,
  phone         text,
  -- Le téléphone n'apparaît dans la signature que si on le demande.
  show_phone    boolean not null default false,

  -- --- Offre d'entrée : la demande la plus légère possible ----------------
  -- 'demo' | 'appel' | 'audit' | 'pilote'
  entry_type     text,
  entry_duration text,
  entry_pitch    text,
  entry_url      text,

  -- --- Promesse -----------------------------------------------------------
  lead_time            text,
  no_tool_change       boolean not null default true,
  human_validation     boolean not null default true,

  -- --- Preuves ------------------------------------------------------------
  -- [{ id, title, sentence, tags: string[], url?, publicOk }]
  proofs jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La page /offre lit la ligne du compte courant : l'index de clé primaire
-- suffit. On garde un index sur `updated_at` pour le tri d'un éventuel audit.
create index if not exists user_offer_updated_idx
  on public.user_offer (updated_at desc);

alter table public.user_offer enable row level security;

drop policy if exists "user_offer_owner" on public.user_offer;
create policy "user_offer_owner" on public.user_offer
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.user_offer to authenticated, service_role;
