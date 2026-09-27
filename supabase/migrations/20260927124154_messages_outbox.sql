-- ===========================================================================
-- Mails : corbeille et envoi programmé
--
-- 1. CORBEILLE — `deleted_at` masque un brouillon ou un mail programmé
--    partout et bloque son envoi ; purge à J+14 par le même cron que les
--    prospects (/api/cron/purge-trash). Un mail envoyé n'y va jamais.
--
-- 2. ENVOI PROGRAMMÉ — `send_status` suit le cycle d'envoi, À CÔTÉ de
--    `status` (enum draft | sent, inchangé) :
--      draft → scheduled → sending → sent
--                        ↘ failed (raison dans `send_error`)
--      cancelled : programmé puis mis à la corbeille (rendu en `draft` à la
--      restauration).
--    Le passage `scheduled → sending` est une mise à jour CONDITIONNELLE
--    (lib/outbox/scheduler.ts) : deux ticks simultanés ne prennent jamais le
--    même mail, Postgres réévaluant le WHERE après le verrou de ligne.
--
-- 3. `prospects.do_not_contact` — tout envoi (manuel ou programmé) est refusé.
--
-- 4. Le cron `orion-jobs-tick` (migration 20260926180133_jobs.sql) n'appelait
--    l'app que s'il existait un job prenable ; il l'appelle désormais aussi
--    quand un mail programmé est échu.
--
-- Migration additive et idempotente : colonnes nullables ou avec défaut,
-- index, contrainte posée une seule fois, cron déprogrammé puis reprogrammé.
-- ===========================================================================

alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists scheduled_at timestamptz;
-- Destinataire confirmé à la programmation : le tick n'a pas d'écran pour le demander.
alter table public.messages add column if not exists scheduled_to text;
alter table public.messages add column if not exists send_status text not null default 'draft';
alter table public.messages add column if not exists send_error text;
alter table public.messages add column if not exists send_attempts int not null default 0;
-- Début de l'envoi en cours : un `sending` trop ancien est déclaré échoué, jamais renvoyé.
alter table public.messages add column if not exists send_started_at timestamptz;
-- Notification « parti / échoué » vue (badge de la barre de navigation).
alter table public.messages add column if not exists send_seen_at timestamptz;
-- Identifiant Gmail rendu par n8n, quand le workflow le renvoie.
alter table public.messages add column if not exists gmail_message_id text;

alter table public.prospects add column if not exists do_not_contact boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_send_status_check') then
    alter table public.messages
      add constraint messages_send_status_check
      check (send_status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'));
  end if;
end
$$;

-- Les mails déjà partis avant cette migration : `send_status` suit `status`.
update public.messages
set send_status = 'sent'
where status = 'sent' and send_status = 'draft';

-- Le tick : « les mails programmés échus, les plus anciens d'abord ».
create index if not exists messages_send_status_scheduled_idx
  on public.messages (send_status, scheduled_at);
-- Les écrans : « mes mails vivants » et « ma corbeille ».
create index if not exists messages_user_deleted_idx
  on public.messages (user_id, deleted_at);

-- ---------------------------------------------------------------------------
-- Cron : même tâche, condition élargie aux mails programmés échus.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron / pg_net indisponibles : cron non reprogrammé.';
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
          and (
            exists (
              select 1 from public.jobs
              where status in ('queued', 'running')
                and (locked_until is null or locked_until < now())
            )
            or exists (
              select 1 from public.messages
              where send_status in ('scheduled', 'sending')
                and deleted_at is null
                and scheduled_at <= now()
            )
          );
      $cron$
    );
  exception when others then
    raise notice 'Cron non reprogrammé : %', sqlerrm;
  end;
end
$$;
