-- ===========================================================================
-- scan_history — memoire des entreprises deja passees au scan
--
-- Raison d'etre : la recherche par criteres rendait toujours les memes
-- entreprises. L'annuaire est interroge avec un tri stable, on ne demandait
-- que la page 1, et rien n'excluait ce qui avait deja ete vu. Resultat :
-- 20 entreprises scannees, les memes que la veille, et des credits Linkup
-- depenses pour rien.
--
-- Cette table enregistre CHAQUE entreprise scannee, qu'elle porte un signal
-- ou non. `had_signal` sert au diagnostic (quel taux de signal sur une zone)
-- et evite de rescanner une entreprise muette pendant 30 jours.
--
-- On garde l'historique par utilisateur : deux comptes ne se privent pas
-- mutuellement de pistes.
--
-- Migration additive : nouvelle table uniquement, aucune table existante
-- n'est modifiee.
-- ===========================================================================

create table if not exists public.scan_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  siren      text not null,
  -- Utile pour relire l'historique sans jointure.
  company_name text,
  had_signal boolean not null default false,
  scanned_at timestamptz not null default now()
);

-- Un SIREN n'a qu'une ligne par compte : on met a jour `scanned_at` a chaque
-- nouveau passage (upsert), plutot que d'empiler des lignes.
create unique index if not exists scan_history_user_siren_key
  on public.scan_history (user_id, siren);

-- L'exclusion lit « les SIREN de ce compte scannes depuis 30 jours » : c'est
-- exactement l'ordre de cet index.
create index if not exists scan_history_user_scanned_idx
  on public.scan_history (user_id, scanned_at desc);

alter table public.scan_history enable row level security;

create policy "scan_history_owner" on public.scan_history
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.scan_history to authenticated, service_role;
