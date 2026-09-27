-- ===========================================================================
-- Entonnoir « signaux d'abord » en 4 étages (lib/funnel)
--
--   1. moisson (BODACC, France Travail)        → statut « brut »
--   2. filtre déterministe (annuaire gratuit)   → « filtré » ou « rejeté »
--   3. tri LLM par lots de 20                   → « retenu » ou « rejeté »
--   4. creusage payant, plafonné                → « creusé » (+ prospect)
--
-- Chaque signal est gardé AVEC son motif de rejet : c'est ce qui permet de
-- mesurer l'entonnoir et de comprendre pourquoi une fiche n'est pas sortie.
--
-- Migration ADDITIVE : deux nouvelles tables, aucune table existante n'est
-- modifiée. Idempotente.
-- ===========================================================================

create table if not exists public.signal_candidates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  /** Run d'origine (ligne search_runs). */
  run_id        uuid references public.search_runs (id) on delete set null,
  /** bodacc | france-travail | linkup */
  source        text not null,
  date_signal   date,
  texte_brut    text not null,
  url_source    text,
  siren         text,
  company_name  text,
  /** Empreinte de dédoublonnage : source + entreprise + date + texte. */
  hash          text not null,
  statut        text not null default 'brut'
                check (statut in ('brut', 'filtré', 'rejeté', 'retenu', 'creusé')),
  motif_rejet   text,
  /** Faits bruts de la source (capital avant/après, dirigeants, poste…). */
  facts         jsonb not null default '{}'::jsonb,
  /** Identité annuaire au moment du filtre (NAF, tranche, siège, diffusion). */
  identity      jsonb,
  /** Poids du filtre déterministe, 0 à 1 ; badges (« décision au siège »…). */
  weight        numeric(4, 3),
  badges        text[] not null default '{}',
  /** Verdict du tri LLM : utilisable, sujet, type, pain, accroche, raison. */
  triage        jsonb,
  score         smallint check (score between 0 and 5),
  /** Résultat du module contact (contrat lib/contact-finder). */
  contact       jsonb,
  prospect_id   uuid references public.prospects (id) on delete set null,
  /** Publication : « pret » si un email est trouvé, sinon « a_completer ». */
  publication   text check (publication in ('pret', 'a_completer')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists signal_candidates_user_hash_key
  on public.signal_candidates (user_id, hash);
create index if not exists signal_candidates_run_idx
  on public.signal_candidates (user_id, run_id, statut);

drop trigger if exists signal_candidates_set_updated_at on public.signal_candidates;
create trigger signal_candidates_set_updated_at
  before update on public.signal_candidates
  for each row execute function public.set_updated_at();

alter table public.signal_candidates enable row level security;

drop policy if exists "signal_candidates_owner" on public.signal_candidates;
create policy "signal_candidates_owner" on public.signal_candidates
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.signal_candidates to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Réglages de l'entonnoir, par utilisateur (zones, secteurs préférés, run
-- quotidien). Table distincte de search_settings : aucune table existante
-- n'est modifiée.
-- ---------------------------------------------------------------------------
create table if not exists public.funnel_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  /** Départements moissonnés (« 69 », « 31 »…). */
  departements       text[] not null default '{}',
  /** Préfixes NAF préférés (services B2B, négoce B2B, logistique, immobilier,
      industrie légère, bâtiment ≥ 20 salariés) : bonus de poids au filtre. */
  preferred_sectors  text[] not null default array['62', '69', '70', '71', '73', '74', '82', '46', '49', '52', '68', '13', '14', '16', '17', '18', '22', '25', '27', '28', '31', '32', '33', '41', '43']::text[],
  /** Préfixes NAF exclus par défaut : épicerie, nettoyage, télécom de détail. */
  excluded_sectors   text[] not null default array['4711', '4729', '812', '4742']::text[],
  days               int not null default 14 check (days between 1 and 90),
  dig_limit          int not null default 15 check (dig_limit between 1 and 60),
  /** Run automatique quotidien à 6h00 (Europe/Paris). */
  daily              boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists funnel_settings_set_updated_at on public.funnel_settings;
create trigger funnel_settings_set_updated_at
  before update on public.funnel_settings
  for each row execute function public.set_updated_at();

alter table public.funnel_settings enable row level security;

drop policy if exists "funnel_settings_owner" on public.funnel_settings;
create policy "funnel_settings_owner" on public.funnel_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.funnel_settings to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Run quotidien à 6h00, heure de Paris.
--
-- pg_cron compte en UTC : on planifie à 4h et 5h UTC, et la requête ne crée
-- le job que s'il est 6h à Paris (heure d'été ou d'hiver). Le cron n'appelle
-- AUCUNE route : il insère un job `search_signals` (params.kind = funnel) en file, que le filet
-- minute existant (`orion-jobs-tick`) fait tourner. Un seul job par jour et
-- par utilisateur.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron indisponible : run quotidien non programmé.';
    return;
  end if;

  begin
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule(jobid) from cron.job where jobname = 'orion-signal-funnel-daily';
    perform cron.schedule(
      'orion-signal-funnel-daily',
      '0 4,5 * * *',
      $cron$
        insert into public.jobs (user_id, type, target, params)
        select f.user_id,
               'search_signals',
               jsonb_build_object('label', 'Signaux du jour'),
               jsonb_build_object('auto', true, 'kind', 'funnel')
        from public.funnel_settings f
        where f.daily
          and cardinality(f.departements) > 0
          and extract(hour from now() at time zone 'Europe/Paris') = 6
          and not exists (
            select 1 from public.jobs j
            where j.user_id = f.user_id
              and j.type = 'search_signals'
              and j.params ->> 'kind' = 'funnel'
              and j.params ->> 'auto' = 'true'
              and j.created_at > now() - interval '20 hours'
          );
      $cron$
    );
  exception when others then
    raise notice 'Run quotidien non programmé : %', sqlerrm;
  end;
end
$$;
