-- ===========================================================================
-- Comptabilité de la micro-entreprise d'Axel — Cowork #70, 18/11/2026
--
-- Tables neuves préfixées compta_ (migration additive et idempotente) :
-- paramètres de l'émetteur, clients, devis, factures et avoirs, encaissements
-- (livre des recettes), dépenses (suivi personnel), déclarations URSSAF,
-- compteurs de numérotation, journal des actions.
--
-- Garanties portées par la BASE (pas seulement par l'interface) :
--   * numérotation F-AAAA-NNN / A-AAAA-NNN attribuée à l'ÉMISSION, sans trou :
--     le compteur est incrémenté dans la même transaction que l'émission
--     (verrou de ligne : deux émissions simultanées se suivent, un échec annule
--     aussi l'incrément) ;
--   * une facture ou un avoir émis n'est plus ni modifiable ni supprimable ;
--   * le total est recalculé par la base à partir des lignes ;
--   * chaque ligne appartient à son propriétaire (RLS owner_id = auth.uid()).
-- ===========================================================================

create table if not exists public.compta_parametres (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nom text not null default '',
  adresse text not null default '',
  siret text not null default '',
  email text,
  telephone text,
  iban text,
  date_debut_activite date,
  acre boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.compta_clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nom text not null check (length(btrim(nom)) > 0),
  professionnel boolean not null default true,
  siren text,
  adresse text not null default '',
  email text,
  crm_ref uuid, -- fiche CRM d'agent2 (liaison optionnelle, sans clé étrangère tant que le CRM n'est pas sur main)
  created_at timestamptz not null default now()
);

create table if not exists public.compta_devis (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  numero text,
  client_id uuid not null references public.compta_clients (id),
  date date not null default ((now() at time zone 'Europe/Paris')::date),
  validite_jours integer not null default 30 check (validite_jours between 1 and 365),
  conditions text not null default '',
  objet text not null default '',
  lignes jsonb not null default '[]'::jsonb check (jsonb_typeof(lignes) = 'array'),
  total bigint not null default 0,
  statut text not null default 'brouillon' check (statut in ('brouillon', 'envoye', 'accepte', 'refuse')),
  facture_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, numero)
);

create table if not exists public.compta_factures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null default 'facture' check (type in ('facture', 'avoir')),
  numero text,
  etat text not null default 'brouillon' check (etat in ('brouillon', 'emise')),
  client_id uuid not null references public.compta_clients (id),
  objet text not null default '',
  date_emission date,
  date_prestation text not null default '',
  echeance_jours integer not null default 30 check (echeance_jours between 0 and 60),
  lignes jsonb not null default '[]'::jsonb check (jsonb_typeof(lignes) = 'array'),
  total bigint not null default 0,
  devis_id uuid references public.compta_devis (id),
  facture_origine_id uuid references public.compta_factures (id),
  motif_avoir text,
  emetteur jsonb, -- coordonnées de l'émetteur FIGÉES à l'émission
  client jsonb, -- coordonnées du client FIGÉES à l'émission
  emise_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, numero),
  check ((etat = 'brouillon') = (numero is null)),
  check ((etat = 'brouillon') = (date_emission is null)),
  check (type = 'facture' or facture_origine_id is not null)
);

create table if not exists public.compta_encaissements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  montant bigint not null check (montant <> 0), -- négatif = remboursement
  moyen text not null check (moyen in ('virement', 'cheque', 'especes', 'carte', 'plateforme', 'autre')),
  facture_id uuid references public.compta_factures (id),
  client_id uuid not null references public.compta_clients (id),
  nature text not null check (length(btrim(nature)) > 0),
  reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.compta_depenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  montant bigint not null check (montant > 0),
  fournisseur text not null default '',
  nature text not null default '',
  justificatif_chemin text,
  created_at timestamptz not null default now()
);

create table if not exists public.compta_declarations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  annee integer not null,
  trimestre integer not null check (trimestre between 1 and 4),
  montant_declare bigint not null,
  declare_le date not null default ((now() at time zone 'Europe/Paris')::date),
  unique (owner_id, annee, trimestre)
);

create table if not exists public.compta_compteurs (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  serie text not null check (serie in ('D', 'F', 'A')),
  annee integer not null,
  dernier integer not null check (dernier > 0),
  primary key (owner_id, serie, annee)
);

create table if not exists public.compta_journal (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quand timestamptz not null default now(),
  objet text not null check (objet in ('devis', 'facture')),
  objet_id uuid not null,
  action text not null,
  detail jsonb
);

create index if not exists compta_encaissements_date_idx on public.compta_encaissements (owner_id, date);
create index if not exists compta_factures_client_idx on public.compta_factures (owner_id, client_id);
create index if not exists compta_journal_objet_idx on public.compta_journal (owner_id, objet_id);

-- ---------------------------------------------------------------------------
-- Numérotation : rang suivant d'une série, dans la transaction appelante.
-- ---------------------------------------------------------------------------
create or replace function public.compta_rang_suivant(p_serie text, p_annee integer)
returns integer
language sql
as $$
  insert into public.compta_compteurs (owner_id, serie, annee, dernier)
  values (auth.uid(), p_serie, p_annee, 1)
  on conflict (owner_id, serie, annee) do update set dernier = public.compta_compteurs.dernier + 1
  returning dernier;
$$;

create or replace function public.compta_total_lignes(p_lignes jsonb)
returns bigint
language sql
immutable
as $$
  select coalesce(sum(round((l ->> 'quantite')::numeric * (l ->> 'prix_unitaire')::numeric)), 0)::bigint
  from jsonb_array_elements(p_lignes) as l;
$$;

-- Devis : numéro D-AAAA-NNN à la création, total recalculé.
create or replace function public.compta_devis_avant()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.numero is null then
    new.numero := 'D-' || extract(year from new.date)::int || '-' || lpad(public.compta_rang_suivant('D', extract(year from new.date)::int)::text, 3, '0');
  end if;
  if tg_op = 'UPDATE' and new.numero is distinct from old.numero then
    raise exception 'Le numéro d''un devis ne change pas';
  end if;
  new.total := public.compta_total_lignes(new.lignes);
  return new;
end;
$$;

drop trigger if exists compta_devis_avant on public.compta_devis;
create trigger compta_devis_avant before insert or update on public.compta_devis
  for each row execute function public.compta_devis_avant();

-- Factures : seul le brouillon se modifie ; émise = immuable et insupprimable.
create or replace function public.compta_factures_garde()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.etat = 'emise' then
      raise exception 'Une facture émise ne se supprime pas : émettez un avoir';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.etat = 'emise' then
    raise exception 'Une facture émise n''est plus modifiable : émettez un avoir';
  end if;
  if tg_op = 'INSERT' and new.etat = 'emise' then
    raise exception 'Une facture naît en brouillon ; elle s''émet par compta_emettre()';
  end if;
  if tg_op = 'UPDATE' and new.etat = 'emise' and current_setting('compta.emission', true) is distinct from 'oui' then
    raise exception 'Une facture s''émet par compta_emettre()';
  end if;
  new.total := public.compta_total_lignes(new.lignes);
  return new;
end;
$$;

drop trigger if exists compta_factures_garde on public.compta_factures;
create trigger compta_factures_garde before insert or update or delete on public.compta_factures
  for each row execute function public.compta_factures_garde();

-- Émission : numéro, date du jour (Paris), coordonnées figées — tout ou rien.
create or replace function public.compta_emettre(p_facture uuid)
returns public.compta_factures
language plpgsql
as $$
declare
  f public.compta_factures;
  p public.compta_parametres;
  c public.compta_clients;
  aujourdhui date := (now() at time zone 'Europe/Paris')::date;
  deja bigint;
begin
  select * into f from public.compta_factures where id = p_facture and owner_id = auth.uid() for update;
  if not found then raise exception 'Facture introuvable'; end if;
  if f.etat <> 'brouillon' then raise exception 'Facture déjà émise (%)', f.numero; end if;
  if jsonb_array_length(f.lignes) = 0 or f.total <= 0 then raise exception 'Une facture sans ligne ou à 0 € ne s''émet pas'; end if;
  select * into p from public.compta_parametres where owner_id = auth.uid();
  if not found or btrim(p.nom) = '' or btrim(p.adresse) = '' or btrim(p.siret) = '' then
    raise exception 'Renseignez le nom, l''adresse et le SIRET dans les paramètres avant d''émettre';
  end if;
  select * into c from public.compta_clients where id = f.client_id;
  if f.type = 'avoir' then
    select coalesce(sum(total), 0) into deja from public.compta_factures
      where facture_origine_id = f.facture_origine_id and type = 'avoir' and etat = 'emise';
    if f.total + deja > (select total from public.compta_factures where id = f.facture_origine_id and etat = 'emise') then
      raise exception 'L''avoir dépasse le montant restant de la facture d''origine';
    end if;
  end if;
  perform set_config('compta.emission', 'oui', true);
  update public.compta_factures set
    etat = 'emise',
    date_emission = aujourdhui,
    emise_at = now(),
    numero = (case when f.type = 'avoir' then 'A' else 'F' end) || '-' || extract(year from aujourdhui)::int || '-'
      || lpad(public.compta_rang_suivant(case when f.type = 'avoir' then 'A' else 'F' end, extract(year from aujourdhui)::int)::text, 3, '0'),
    emetteur = jsonb_build_object('nom', p.nom, 'adresse', p.adresse, 'siret', p.siret, 'email', p.email, 'telephone', p.telephone, 'iban', p.iban),
    client = jsonb_build_object('nom', c.nom, 'adresse', c.adresse, 'siren', c.siren, 'professionnel', c.professionnel, 'email', c.email)
  where id = f.id
  returning * into f;
  perform set_config('compta.emission', 'non', true);
  return f;
end;
$$;

-- Devis → facture brouillon en un clic (le devis passe « accepté »).
create or replace function public.compta_devis_vers_facture(p_devis uuid)
returns uuid
language plpgsql
as $$
declare
  d public.compta_devis;
  nouvelle uuid;
begin
  select * into d from public.compta_devis where id = p_devis and owner_id = auth.uid() for update;
  if not found then raise exception 'Devis introuvable'; end if;
  if d.facture_id is not null then return d.facture_id; end if;
  insert into public.compta_factures (client_id, objet, lignes, devis_id, date_prestation)
  values (d.client_id, d.objet, d.lignes, d.id, '')
  returning id into nouvelle;
  update public.compta_devis set facture_id = nouvelle, statut = 'accepte' where id = d.id;
  return nouvelle;
end;
$$;

-- Encaissement : seulement sur une facture émise (pas un avoir), du même client.
create or replace function public.compta_encaissements_garde()
returns trigger
language plpgsql
as $$
begin
  if new.facture_id is not null and not exists (
    select 1 from public.compta_factures
    where id = new.facture_id and etat = 'emise' and type = 'facture' and client_id = new.client_id
  ) then
    raise exception 'Un encaissement se rattache à une facture émise du même client';
  end if;
  return new;
end;
$$;

drop trigger if exists compta_encaissements_garde on public.compta_encaissements;
create trigger compta_encaissements_garde before insert or update on public.compta_encaissements
  for each row execute function public.compta_encaissements_garde();

-- Journal des actions sur devis et factures.
create or replace function public.compta_journaliser()
returns trigger
language plpgsql
as $$
declare
  ligne record;
  action text := lower(tg_op);
begin
  if tg_op = 'DELETE' then ligne := old; else ligne := new; end if;
  -- Un IF par table : PL/pgSQL résout tous les champs d'une condition (old.statut n'existe pas sur une facture).
  if tg_op = 'UPDATE' and tg_table_name = 'compta_factures' then
    if old.etat = 'brouillon' and new.etat = 'emise' then action := 'emission'; end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'compta_devis' then
    if old.statut is distinct from new.statut then action := 'statut:' || new.statut; end if;
  end if;
  insert into public.compta_journal (owner_id, objet, objet_id, action, detail)
  values (ligne.owner_id, case when tg_table_name = 'compta_devis' then 'devis' else 'facture' end, ligne.id, action,
          jsonb_build_object('numero', ligne.numero, 'total', ligne.total));
  return null;
end;
$$;

drop trigger if exists compta_devis_journal on public.compta_devis;
create trigger compta_devis_journal after insert or update or delete on public.compta_devis
  for each row execute function public.compta_journaliser();
drop trigger if exists compta_factures_journal on public.compta_factures;
create trigger compta_factures_journal after insert or update or delete on public.compta_factures
  for each row execute function public.compta_journaliser();

-- ---------------------------------------------------------------------------
-- RLS : chaque ligne n'est visible et modifiable que par son propriétaire.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['compta_parametres', 'compta_clients', 'compta_devis', 'compta_factures', 'compta_encaissements',
                           'compta_depenses', 'compta_declarations', 'compta_compteurs', 'compta_journal'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_proprietaire', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_proprietaire', t);
  end loop;
end;
$$;

-- Sans GRANT, la RLS ne suffit pas : PostgREST refuse en 42501.
grant select, insert, update, delete on public.compta_parametres, public.compta_clients, public.compta_devis,
  public.compta_factures, public.compta_encaissements, public.compta_depenses, public.compta_declarations to authenticated;
grant select, insert, update on public.compta_compteurs to authenticated;
grant select, insert on public.compta_journal to authenticated;
grant execute on function public.compta_emettre(uuid), public.compta_devis_vers_facture(uuid), public.compta_rang_suivant(text, integer),
  public.compta_total_lignes(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Justificatifs de dépenses : bucket PRIVÉ, un dossier par propriétaire.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('compta-justificatifs', 'compta-justificatifs', false)
on conflict (id) do nothing;

drop policy if exists "compta_justificatifs_proprietaire" on storage.objects;
create policy "compta_justificatifs_proprietaire" on storage.objects
  for all to authenticated
  using (bucket_id = 'compta-justificatifs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'compta-justificatifs' and (storage.foldername(name))[1] = auth.uid()::text);
