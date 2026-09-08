-- ===========================================================================
-- Privilèges de table pour les 4 tables ORION
--
-- La RLS filtre les lignes, mais PostgREST a d'abord besoin du privilège SQL
-- sur la table : sans GRANT, toute requête échoue en `42501 permission denied`,
-- policies ou pas. Les privilèges par défaut de ce projet ne donnent que
-- REFERENCES/TRIGGER/TRUNCATE, d'où ce rattrapage explicite.
--
--   authenticated -> l'utilisateur connecté de l'app (clé anon + session).
--                    Les policies `..._owner` restreignent ensuite à ses lignes.
--   service_role  -> jobs et webhooks n8n via createAdminClient() (hors RLS).
--
-- `anon` est volontairement exclu : l'app n'a aucun accès anonyme.
-- Migration additive : ne touche qu'aux tables ORION.
-- ===========================================================================

grant select, insert, update, delete on public.prospects to authenticated, service_role;
grant select, insert, update, delete on public.messages  to authenticated, service_role;
grant select, insert, update, delete on public.deals     to authenticated, service_role;
grant select, insert, update, delete on public.reminders to authenticated, service_role;
