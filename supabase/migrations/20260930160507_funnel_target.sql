-- Cible de l'entonnoir : action sociale (NAF 88) exclue par défaut.
--
-- Rejeu du 30/09/2026 : AIN DOMICILE SERVICES (88.10A, aide à domicile) était
-- retenue. Le défaut passe de « 8891 » (garde d'enfants) à « 88 » (toute
-- l'action sociale). Données uniquement, avec WHERE : seul un réglage resté
-- aux défauts précédents (PR #47) est mis à jour. Idempotent.
update public.funnel_settings
set excluded_sectors = array['47', '55', '56', '96', '93', '88', '862', '869', '812']::text[]
where excluded_sectors = array['47', '55', '56', '96', '93', '8891', '862', '869', '812']::text[];
