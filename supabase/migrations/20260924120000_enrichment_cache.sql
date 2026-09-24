-- ===========================================================================
-- enrichment_cache — mémoire courte des appels payants
--
-- Motivation : résoudre le dirigeant derrière une holding demande une fiche
-- Pappers SUPPLÉMENTAIRE, facturée un crédit. La même holding revient souvent
-- (un groupe détient plusieurs cibles) et ses données bougent rarement : on
-- garde donc la réponse 30 jours plutôt que de repayer.
--
-- La donnée mise en cache est PUBLIQUE (registre du commerce) : le cache est
-- partagé entre utilisateurs, sans `user_id`. La RLS reste activée — l'accès
-- est ouvert aux comptes connectés, ce qui n'expose rien de personnel et évite
-- qu'un utilisateur paie pour ce qu'un autre a déjà payé.
--
-- Migration additive : nouvelle table uniquement.
-- ===========================================================================

create table if not exists public.enrichment_cache (
  -- Clé applicative : "<source>:<opération>:<identifiant>".
  key        text primary key,
  payload    jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Purge et lecture se font toutes deux sur l'échéance.
create index if not exists enrichment_cache_expires_idx
  on public.enrichment_cache (expires_at);

alter table public.enrichment_cache enable row level security;

-- Données publiques, mutualisées : lecture et écriture pour tout compte connecté.
create policy "enrichment_cache_shared" on public.enrichment_cache
  for all to authenticated
  using (true)
  with check (true);

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.enrichment_cache to authenticated, service_role;
