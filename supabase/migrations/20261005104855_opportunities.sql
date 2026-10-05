-- ===========================================================================
-- OPPORTUNITÉS — annonces des plateformes freelance (Codeur, Upwork, ComeUp,
-- Malt…) saisies À LA MAIN (V1 : copier-coller), analysées par l'IA, avec une
-- proposition rédigée à copier. Aucun envoi, aucune connexion aux
-- plateformes, aucun scraping : la réponse part par la main d'Axel.
--
-- Migration additive et idempotente : table nouvelle uniquement.
-- ===========================================================================

create table if not exists public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade default auth.uid(),
  platform        text not null default 'codeur' check (platform in ('codeur', 'upwork', 'comeup', 'malt', 'autre')),
  url             text,
  title           text not null,
  body            text not null,
  budget          text,
  deadline        date,
  -- Analyse IA
  language        text,
  fit_score       numeric,
  fit_reasons     jsonb,
  need            text,
  demo            text,
  analyzed_at     timestamptz,
  -- Proposition rédigée
  proposal        text,
  proposal_score  numeric,
  proposal_reason text,
  -- Suivi
  status          text not null default 'a_repondre' check (status in ('a_repondre', 'envoyee', 'reponse', 'entretien', 'gagnee', 'perdue', 'ignoree')),
  notes           text,
  amount_eur      numeric,
  sent_at         timestamptz,
  replied_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists opportunities_user_idx on public.opportunities (user_id, created_at desc);

alter table public.opportunities enable row level security;

drop policy if exists "opportunities_owner" on public.opportunities;
create policy "opportunities_owner" on public.opportunities
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update on public.opportunities to authenticated, service_role;
