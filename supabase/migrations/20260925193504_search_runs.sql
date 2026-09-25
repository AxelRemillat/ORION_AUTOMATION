-- ===========================================================================
-- Scans de recherche suivis en direct
--
-- Le scan devient un travail observable : une ligne par lancement, dont la
-- progression est ecrite au fil des lots. Le client la relit par sondage, ce
-- qui permet trois choses impossibles jusqu'ici — une barre d'avancement
-- honnete, un bouton « Arreter », et des resultats qui survivent a un
-- changement de page ou a un rechargement.
--
-- `results` est en jsonb plutot qu'en table fille : ce sont des entreprises
-- ENRICHIES, pas encore des prospects. Elles n'ont de sens que le temps qu'on
-- les regarde, et les normaliser obligerait a les detruire au scan suivant.
--
-- Migration additive et idempotente.
-- ===========================================================================

create table if not exists public.search_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  /** Criteres du lancement, tels qu'envoyes par l'ecran. */
  criteria    jsonb not null default '{}'::jsonb,
  /** running | done | stopped | error */
  status      text not null default 'running',
  /** { pagesRead, pagesTotal, scanned, withSignal, analysed, unverified, step } */
  progress    jsonb not null default '{}'::jsonb,
  results     jsonb not null default '[]'::jsonb,
  warnings    jsonb not null default '[]'::jsonb,
  error       text,
  /** Passe a vrai quand l'utilisateur demande l'arret ; le scan le relit. */
  stop_requested boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'search_runs_status_check'
  ) then
    alter table public.search_runs
      add constraint search_runs_status_check
      check (status in ('running', 'done', 'stopped', 'error'));
  end if;
end
$$;

-- L'ecran ne lit qu'une chose : le dernier lancement de l'utilisateur.
create index if not exists search_runs_user_recent_idx
  on public.search_runs (user_id, created_at desc);

-- Maintien de `updated_at` : c'est lui qui distingue un scan vivant d'un scan
-- dont la fonction serverless a ete coupee en cours de route.
drop trigger if exists search_runs_set_updated_at on public.search_runs;
create trigger search_runs_set_updated_at
  before update on public.search_runs
  for each row execute function public.set_updated_at();

alter table public.search_runs enable row level security;

drop policy if exists "search_runs_owner" on public.search_runs;
create policy "search_runs_owner" on public.search_runs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la policy ne sert a rien : PostgREST echoue en 42501 avant meme
-- de l'evaluer. `anon` reste exclu.
grant select, insert, update, delete on public.search_runs to authenticated, service_role;
