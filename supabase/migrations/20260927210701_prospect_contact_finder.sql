-- ===========================================================================
-- Contact trouvé par le module lib/contact-finder
--
-- Une adresse sans provenance ne vaut rien : on ne sait ni si elle désigne une
-- personne, ni où elle a été vue, ni à quel point on y croit. Ces colonnes le
-- disent, et la fiche affiche la source cliquable.
--
--   email_type          nominatif | generique
--   email_source_url    page (mentions légales, contact…) ou source Hunter
--   contact_confidence  0-100
--   contact_found_by    chemin qui a produit l'adresse (« site:mentions-legales »…)
--   contact_search      journal de la dernière recherche : candidats, dépenses
--   contact_checked_at  date de la dernière recherche
--
-- Migration additive et idempotente : colonnes nullables, aucune donnée
-- réécrite. La table est déjà couverte par RLS et GRANT (init + orion_grants).
-- ===========================================================================

alter table public.prospects add column if not exists email_type text;
alter table public.prospects add column if not exists email_source_url text;
alter table public.prospects add column if not exists contact_confidence smallint;
alter table public.prospects add column if not exists contact_found_by text;
alter table public.prospects add column if not exists contact_search jsonb;
alter table public.prospects add column if not exists contact_checked_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospects_email_type_check') then
    alter table public.prospects
      add constraint prospects_email_type_check
      check (email_type is null or email_type in ('nominatif', 'generique'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospects_contact_confidence_check') then
    alter table public.prospects
      add constraint prospects_contact_confidence_check
      check (contact_confidence is null or contact_confidence between 0 and 100);
  end if;
end
$$;
