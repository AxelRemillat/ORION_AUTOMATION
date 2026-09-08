-- ===========================================================================
-- prospects.email — adresse de contact du prospect
--
-- Alimentée par l'enrichissement (Pappers) à l'ajout depuis la Recherche, et
-- par Hunter au moment de l'analyse d'un prospect. Nullable : beaucoup de
-- fiches n'ont pas d'adresse connue, l'envoi la demande alors manuellement.
-- Aucune contrainte d'unicité : deux prospects peuvent partager un contact.
-- ===========================================================================

alter table public.prospects
  add column if not exists email text;

comment on column public.prospects.email is
  'Adresse de contact trouvée par l''enrichissement (Pappers/Hunter), ou saisie à la main.';
