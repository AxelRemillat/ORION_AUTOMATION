-- ===========================================================================
-- Expérience n° 2 — FAMILLE du mail (F1 problème métier, F2 présentation
-- directe, F3 question courte, F4 démo d'abord), pour comparer envois,
-- réponses et taux par famille (Pipeline, Réglages › Données).
--
-- Migration additive et idempotente : une colonne nullable, rien d'autre.
-- ===========================================================================

alter table public.message_variants add column if not exists family text;

create index if not exists message_variants_family_idx on public.message_variants (user_id, family);
