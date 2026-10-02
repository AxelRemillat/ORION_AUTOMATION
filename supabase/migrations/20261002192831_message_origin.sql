-- ===========================================================================
-- Origine d'un brouillon : `eval` (npm run eval:mails) ou `script`.
--
-- Les brouillons écrits par l'évaluation ou par un script ne doivent JAMAIS
-- remonter dans « Aujourd'hui » ni être réécrits par une génération normale
-- (ARTFLEX, 02/10/2026 : un brouillon d'éval apparaissait en « Nouveaux
-- prospects » alors que l'intro était partie le 30/09).
--
-- Colonne AJOUTÉE, nullable, sans défaut : NULL = brouillon de l'application.
-- Aucune ligne existante n'est réécrite. Migration additive et idempotente.
-- ===========================================================================
alter table public.messages add column if not exists origin text;

comment on column public.messages.origin is
  'Provenance d''un brouillon hors application : eval (eval:mails) ou script. NULL = application.';
