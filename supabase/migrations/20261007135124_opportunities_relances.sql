-- ===========================================================================
-- RELANCES SUGGÉRÉES (plateformes #6) — 07/10/2026
--
-- Une proposition « Envoyée » sans réponse depuis 3 jours (Codeur, Malt,
-- ComeUp) ou 5 jours (Upwork) appelle une relance courte, rédigée par ORION et
-- copiée par Axel. Rien n'est envoyé automatiquement.
--
--   follow_up_text : texte de relance proposé (moins de 400 caractères)
--   followed_up_at : « Marquer relancée » (la relance n'est plus due)
--
-- Migration additive et idempotente : deux colonnes nullables.
-- ===========================================================================

alter table public.opportunities add column if not exists follow_up_text text;
alter table public.opportunities add column if not exists followed_up_at timestamptz;
