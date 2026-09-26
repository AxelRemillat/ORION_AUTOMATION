-- ===========================================================================
-- Filet pg_cron des jobs : nouvelle tentative de programmation
--
-- La migration 20260926180133_jobs.sql programme le cron `orion-jobs-tick`
-- SI pg_cron et pg_net sont activables au moment ou elle passe. Une migration
-- deja appliquee n'est jamais rejouee : si les extensions ont ete activees
-- apres coup, seule une NOUVELLE migration peut programmer le cron.
--
-- Meme bloc, strictement idempotent : le cron existant est deprogramme puis
-- reprogramme a l'identique. Sans les extensions, rien ne se passe et la
-- migration passe quand meme.
-- ===========================================================================

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
