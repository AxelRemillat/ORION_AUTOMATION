-- ===========================================================================
-- api_usage — consommation reelle des APIs tierces
--
-- Une ligne par APPEL effectif a un fournisseur. Sert a repondre a trois
-- questions : combien j'ai consomme par service, combien me coute un prospect
-- enrichi, et combien de prospects je peux encore traiter.
--
-- Conventions d'unites, volontairement explicites :
--   - `units`     : quantite dans l'unite NATIVE du fournisseur — tokens pour
--                   OpenAI, credits pour Pappers, recherches pour Linkup et
--                   Hunter. Toujours EXACTE, comptee a l'appel.
--   - `unit_cost` : prix unitaire en euros, tel que connu au moment de l'appel.
--                   Vaut 0 quand aucun prix n'est configure (Pappers, Hunter).
--   - `cost`      : cout en EUROS de cet appel. Les services factures en
--                   dollars (OpenAI, Linkup) sont convertis a l'insertion ;
--                   le taux est une approximation, l'ecran le signale.
--
-- Migration additive : nouvelle table uniquement.
-- ===========================================================================

create table if not exists public.api_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  service     text not null check (service in ('openai', 'pappers', 'linkup', 'hunter')),
  operation   text not null,
  units       numeric(14, 4) not null default 1,
  unit_cost   numeric(14, 6) not null default 0,
  cost        numeric(14, 6) not null default 0,
  -- Le prospect a l'origine de l'appel, quand il y en a un. `on delete set
  -- null` : supprimer un prospect ne doit pas effacer l'historique de cout.
  prospect_id uuid references public.prospects (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Agregations de la page Couts : par service, et sur une periode.
create index if not exists api_usage_user_service_idx
  on public.api_usage (user_id, service, created_at desc);
create index if not exists api_usage_user_created_idx
  on public.api_usage (user_id, created_at desc);
-- Sert au calcul du cout moyen par prospect enrichi.
create index if not exists api_usage_prospect_idx
  on public.api_usage (prospect_id)
  where prospect_id is not null;

alter table public.api_usage enable row level security;

create policy "api_usage_owner" on public.api_usage
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.api_usage to authenticated, service_role;
