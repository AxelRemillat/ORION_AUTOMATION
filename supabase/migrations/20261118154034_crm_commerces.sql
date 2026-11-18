-- ===========================================================================
-- CRM du Web des Artisans — lot 1 (Cowork #117, 18/11/2026)
--
-- ORION devient l'outil admin d'Axel : suivi des commerces prospectés et des clients du Web des Artisans.
-- Trois tables neuves, préfixées `crm_` (la comptabilité d'agent4 utilise `compta_`) :
--
--   crm_offres      liste PARAMÉTRABLE des offres (Essentiel…), elle va changer : jamais codée en dur ;
--   crm_commerces   la fiche commerce (étape du pipeline, prochaine action, devis, accord de démonstration) ;
--   crm_evenements  la chronologie de chaque fiche (appels, visites, messages, RDV, devis, notes, changements d'étape).
--
-- Additive et idempotente. Rien n'est supprimé : pas de DELETE accordé, une fiche se masque (`archivee_le`).
-- Axel seul : chaque ligne porte `user_id` (= auth.uid()) et la policy le vérifie, GRANT dans la même migration.
-- ===========================================================================

create table if not exists public.crm_offres (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  libelle text not null,
  description text,
  prix_indicatif numeric(10, 2),
  ordre int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_commerces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  -- Identité
  nom text not null,
  metier text,
  ville text,
  adresse text,
  telephone text,
  instagram text,
  fiche_google text,
  site_existant boolean,
  site_url text,
  siren text,
  contact_prenom text,
  contact_role text,
  canal text not null default 'terrain'
    check (canal in ('terrain', 'telephone', 'instagram', 'prescripteur', 'entrant', 'upwork_comeup', 'prospection_email')),
  maquette_url text,
  notes text,
  -- Pipeline
  etape text not null default 'a_contacter'
    check (etape in ('a_contacter', 'contacte', 'maquette_envoyee', 'rdv', 'devis_envoye', 'signe', 'en_ligne', 'perdu')),
  motif_perte text,
  etape_le timestamptz not null default now(),
  prochaine_action text,
  prochaine_action_le date,
  -- Web des Artisans
  offre_id uuid references public.crm_offres (id) on delete set null,
  montant_devis numeric(10, 2),
  date_signature date,
  accord_demo boolean not null default false,
  accord_demo_le date,
  -- Lien avec l'ancienne prospection (fiche importée) et avec la future plateforme (agent3)
  prospect_id uuid references public.prospects (id) on delete set null,
  plateforme_client_id text,
  archivee_le timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_evenements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  commerce_id uuid not null references public.crm_commerces (id) on delete cascade,
  type text not null check (type in ('appel', 'visite', 'message', 'rdv', 'devis', 'note', 'etape')),
  contenu text,
  survenu_le timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_offres_user_idx on public.crm_offres (user_id, ordre);
create index if not exists crm_commerces_user_etape_idx on public.crm_commerces (user_id, etape) where archivee_le is null;
create index if not exists crm_commerces_action_idx on public.crm_commerces (user_id, prochaine_action_le) where archivee_le is null;
create unique index if not exists crm_commerces_prospect_uniq on public.crm_commerces (prospect_id) where prospect_id is not null;
create index if not exists crm_evenements_commerce_idx on public.crm_evenements (commerce_id, survenu_le desc);

-- updated_at tenu par le déclencheur commun (défini par la migration init).
drop trigger if exists crm_offres_set_updated_at on public.crm_offres;
create trigger crm_offres_set_updated_at before update on public.crm_offres
  for each row execute function public.set_updated_at();
drop trigger if exists crm_commerces_set_updated_at on public.crm_commerces;
create trigger crm_commerces_set_updated_at before update on public.crm_commerces
  for each row execute function public.set_updated_at();

alter table public.crm_offres enable row level security;
alter table public.crm_commerces enable row level security;
alter table public.crm_evenements enable row level security;

drop policy if exists "crm_offres_owner" on public.crm_offres;
create policy "crm_offres_owner" on public.crm_offres
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "crm_commerces_owner" on public.crm_commerces;
create policy "crm_commerces_owner" on public.crm_commerces
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Un événement ne peut viser qu'une fiche du même propriétaire.
drop policy if exists "crm_evenements_owner" on public.crm_evenements;
create policy "crm_evenements_owner" on public.crm_evenements
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.crm_commerces c where c.id = commerce_id and c.user_id = (select auth.uid()))
  );

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501. Pas de DELETE : on masque, on n'efface pas.
grant select, insert, update on public.crm_offres to authenticated, service_role;
grant select, insert, update on public.crm_commerces to authenticated, service_role;
grant select, insert, update on public.crm_evenements to authenticated, service_role;
