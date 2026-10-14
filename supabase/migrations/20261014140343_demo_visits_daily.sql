-- ===========================================================================
-- Démos ouvertes depuis les mails — Cowork #34, 14/10/2026
--
-- Mesure GRATUITE et AGRÉGÉE : le portfolio signale, côté serveur, chaque
-- arrivée d'un lien de mail ORION (paramètre v=) et chaque démo lancée ou
-- aboutie. ORION ne garde que des COMPTEURS par jour × démo × v × type :
-- aucun identifiant, aucune IP, aucun user-agent, aucun e-mail, aucun nom.
--
-- Écriture : uniquement par la route /api/demo-visits (clé service), via
-- increment_demo_visit (insert … on conflict, atomique). Lecture : le Cockpit.
-- Migration additive et idempotente : une table neuve, une fonction neuve.
-- ===========================================================================

create table if not exists public.demo_visits_daily (
  day date not null,
  demo text not null check (demo ~ '^[a-z][a-z0-9-]{0,31}$'),
  v text not null check (v ~ '^[0-9]{1,2}$'),
  type text not null check (type in ('arrivee', 'demo_start', 'demo_result')),
  count integer not null default 0 check (count >= 0),
  primary key (day, demo, v, type)
);

alter table public.demo_visits_daily enable row level security;

-- Des compteurs, rien de personnel : lisibles par l'application connectée.
drop policy if exists "demo_visits_daily_read" on public.demo_visits_daily;
create policy "demo_visits_daily_read" on public.demo_visits_daily
  for select to authenticated
  using (true);

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select on public.demo_visits_daily to authenticated;
grant select, insert, update on public.demo_visits_daily to service_role;

create or replace function public.increment_demo_visit(p_day date, p_demo text, p_v text, p_type text)
returns void
language sql
as $$
  insert into public.demo_visits_daily (day, demo, v, type, count)
  values (p_day, p_demo, p_v, p_type, 1)
  on conflict (day, demo, v, type) do update set count = public.demo_visits_daily.count + 1;
$$;

revoke execute on function public.increment_demo_visit(date, text, text, text) from public, anon, authenticated;
grant execute on function public.increment_demo_visit(date, text, text, text) to service_role;
