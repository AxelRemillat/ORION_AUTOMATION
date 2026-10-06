-- ===========================================================================
-- Contacts nominatifs — 06/10/2026
--
-- La plupart des mails partaient sur contact@ / info@. ORION écrit désormais à
-- la personne dont la fonction correspond au sujet du mail (Hunter), et doit
-- savoir À QUI il écrit :
--
--   prospects.contact_name    « Prénom Nom » de la personne contactée
--   prospects.contact_role    son poste (Hunter) ou le rôle visé
--   prospects.contact_source  « hunter:domain-search », « hunter:email-finder »…
--
--   messages.regenerate_reason        brouillon à régénérer, et pourquoi
--   messages.regenerate_requested_at  (le contact a changé après la rédaction)
--
-- Migration additive et idempotente : des colonnes nullables, rien d'autre.
-- Aucune donnée existante n'est modifiée ni supprimée.
-- ===========================================================================

alter table public.prospects add column if not exists contact_name text;
alter table public.prospects add column if not exists contact_role text;
alter table public.prospects add column if not exists contact_source text;

alter table public.messages add column if not exists regenerate_reason text;
alter table public.messages add column if not exists regenerate_requested_at timestamptz;

create index if not exists messages_regenerate_idx
  on public.messages (user_id)
  where regenerate_reason is not null;
