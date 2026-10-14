-- ===========================================================================
-- Expériences sur les mails — Cowork #30, 14/10/2026
--
-- Cadre SEUL : aucune expérience n'est créée ni activée ici.
--
--   mail_experiments            : nom, variantes (clé + phrase d'appel à
--                                 l'action), actif ou non, date de début.
--                                 Une seule expérience active à la fois.
--   mail_experiment_assignments : la variante de CHAQUE brouillon d'intro,
--                                 tirée à la rédaction. Insertion seule
--                                 (aucun GRANT update) : une variante posée ne
--                                 change jamais, même si le brouillon est
--                                 régénéré, validé ou programmé.
--
-- Migration additive et idempotente : deux tables neuves, des policies
-- recréées. Rien n'est modifié ni supprimé ailleurs (messages intacte).
-- ===========================================================================

create table if not exists public.mail_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null,
  -- [{ "key": "A", "cta": "Auriez-vous 15 minutes la semaine prochaine ?" }, …]
  variants jsonb not null,
  active boolean not null default false,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists mail_experiments_one_active
  on public.mail_experiments (user_id) where active;

alter table public.mail_experiments enable row level security;

drop policy if exists "mail_experiments_owner" on public.mail_experiments;
create policy "mail_experiments_owner" on public.mail_experiments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update on public.mail_experiments to authenticated, service_role;

create table if not exists public.mail_experiment_assignments (
  message_id uuid primary key references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  experiment_id uuid not null references public.mail_experiments (id) on delete cascade,
  variant text not null,
  assigned_at timestamptz not null default now()
);

create index if not exists mail_experiment_assignments_experiment_idx
  on public.mail_experiment_assignments (experiment_id, variant);

alter table public.mail_experiment_assignments enable row level security;

drop policy if exists "mail_experiment_assignments_owner" on public.mail_experiment_assignments;
create policy "mail_experiment_assignments_owner" on public.mail_experiment_assignments
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert on public.mail_experiment_assignments to authenticated, service_role;
