-- ===========================================================================
-- Travaux de fond : recherches et generations qui survivent a l'ecran
--
-- Une recherche ou une generation de mail n'est plus liee a l'onglet qui l'a
-- lancee : c'est une ligne `jobs`, decoupee en etapes courtes, que
-- /api/jobs/tick fait avancer une etape a la fois. Fermer l'app ne coupe
-- rien : la prochaine etape est reprise par la chaine de ticks, et, en
-- dernier recours, par pg_cron (plus bas).
--
-- `search_runs` n'est PAS remplace : il porte les entreprises trouvees par un
-- scan (resultats a afficher, pas encore des prospects). Un job de recherche
-- ecrit dans sa ligne `search_runs` et en garde l'id dans `result.runId`.
--
-- Migration additive et idempotente.
-- ===========================================================================

create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  /** search_criteria | search_signals | email_generate | email_rewrite | reanalyze */
  type          text not null,
  /** { prospectId?, label } : ce que l'ecran affiche. */
  target        jsonb not null default '{}'::jsonb,
  params        jsonb not null default '{}'::jsonb,
  /** queued | running | done | failed | cancelled */
  status        text not null default 'queued',
  /** { step, pct, counts: { scanned, signals, sheets } } */
  progress      jsonb not null default '{}'::jsonb,
  /** { prospectIds?, messageId?, runId? } */
  result        jsonb not null default '{}'::jsonb,
  error         text,
  /** Tentatives de l'etape EN COURS : remis a zero a chaque etape reussie. */
  attempts      int not null default 0,
  /** Bail de l'executeur : tant qu'il court, personne d'autre ne prend le job. */
  locked_until  timestamptz,
  seen_at       timestamptz,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  -- Colonnes internes a l'executeur : l'ecran n'a pas a les lire.
  /** Index de la prochaine etape a executer. */
  step          int not null default 0,
  /** Point de reprise entre deux etapes (contact trouve, brief, runId...). */
  state         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_status_check') then
    alter table public.jobs
      add constraint jobs_status_check
      check (status in ('queued', 'running', 'done', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'jobs_type_check') then
    alter table public.jobs
      add constraint jobs_type_check
      check (type in ('search_criteria', 'search_signals', 'email_generate', 'email_rewrite', 'reanalyze'));
  end if;
end
$$;

-- L'ecran lit « mes jobs actifs ou non vus » ; l'executeur, « le plus ancien
-- job prenable ».
create index if not exists jobs_user_status_idx on public.jobs (user_id, status, created_at desc);
create index if not exists jobs_pending_idx on public.jobs (created_at)
  where status in ('queued', 'running');

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

alter table public.jobs enable row level security;

drop policy if exists "jobs_owner" on public.jobs;
create policy "jobs_owner" on public.jobs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Policy sans GRANT = 42501. Pas de DELETE : un job se termine, il ne
-- disparait pas (c'est l'historique de ce qui a ete depense).
grant select, insert, update on public.jobs to authenticated;
grant select, insert, update, delete on public.jobs to service_role;

-- ---------------------------------------------------------------------------
-- claim_job : prend UNE etape a executer, sous verrou.
--
--   - un job `running` dont le bail est libre (entre deux etapes) ou expire
--     (fonction coupee, bloque depuis plus de 5 min) passe en premier : on
--     finit ce qui est commence avant d'ouvrir autre chose ;
--   - un job `queued` ne demarre que si son proprietaire a moins de
--     `p_max_running` jobs `running` ;
--   - FOR UPDATE SKIP LOCKED : deux ticks simultanes ne prennent jamais la
--     meme ligne, et le verrou consultatif serialise le comptage des jobs
--     running (sans lui, deux ticks pourraient demarrer le 3e et le 4e).
--
-- Chaque prise compte une tentative : une etape qui fait tomber la fonction
-- est donc comptee, meme si elle n'a jamais pu ecrire son echec.
-- ---------------------------------------------------------------------------
create or replace function public.claim_job(
  p_job_id uuid default null,
  p_lease_seconds int default 315,
  p_max_running int default 3
)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  picked public.jobs;
begin
  perform pg_advisory_xact_lock(hashtext('public.claim_job'));

  select j.* into picked
  from public.jobs j
  where (p_job_id is null or j.id = p_job_id)
    and (j.locked_until is null or j.locked_until < now())
    and (
      j.status = 'running'
      or (
        j.status = 'queued'
        and (
          select count(*) from public.jobs r
          where r.user_id = j.user_id and r.status = 'running'
        ) < p_max_running
      )
    )
  order by (j.status = 'running') desc, j.created_at
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.jobs
  set status = 'running',
      started_at = coalesce(started_at, now()),
      locked_until = now() + make_interval(secs => p_lease_seconds),
      attempts = attempts + 1
  where id = picked.id
  returning * into picked;

  return next picked;
end
$$;

-- Reserve au serveur (client service_role) : un utilisateur ne doit pas
-- pouvoir s'attribuer un bail.
revoke execute on function public.claim_job(uuid, int, int) from public;
revoke execute on function public.claim_job(uuid, int, int) from anon, authenticated;
grant execute on function public.claim_job(uuid, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Filet de securite : pg_cron + pg_net, toutes les minutes.
--
-- La chaine de ticks (chaque etape declenche la suivante) suffit tant que
-- rien ne casse. Si une fonction est coupee, ce cron relance /api/jobs/tick
-- dans la minute. Il n'appelle l'app QUE s'il existe un job prenable : pas
-- de reveil inutile de Vercel.
--
-- L'URL et le secret ne sont pas dans le depot : ils sont lus a chaque
-- execution dans Supabase Vault (secrets `orion_app_url` et
-- `jobs_tick_secret`). Tant qu'ils manquent, le cron ne fait rien.
--
-- Si pg_cron ou pg_net ne sont pas disponibles, ce bloc ne fait rien et la
-- migration passe quand meme : l'alternative (workflow n8n planifie) est
-- decrite dans lib/jobs/README.md.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net indisponibles : filet de securite non programme.';
    return;
  end if;

  begin
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;

    perform cron.unschedule(jobid) from cron.job where jobname = 'orion-jobs-tick';

    perform cron.schedule(
      'orion-jobs-tick',
      '* * * * *',
      $cron$
        select net.http_post(
          url := s.url || '/api/jobs/tick',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || s.secret
          ),
          body := '{"fanout":3}'::jsonb,
          timeout_milliseconds := 10000
        )
        from (
          select
            (select rtrim(decrypted_secret, '/') from vault.decrypted_secrets where name = 'orion_app_url') as url,
            (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_tick_secret') as secret
        ) s
        where s.url is not null
          and s.secret is not null
          and exists (
            select 1 from public.jobs
            where status in ('queued', 'running')
              and (locked_until is null or locked_until < now())
          );
      $cron$
    );
  exception when others then
    -- Droits insuffisants, Vault absent... : on le signale sans bloquer les
    -- migrations suivantes.
    raise notice 'Filet pg_cron non programme : %', sqlerrm;
  end;
end
$$;
