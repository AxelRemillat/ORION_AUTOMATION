-- Qualité de l'entonnoir (run du 30/09/2026 : 11 micro-reprises B2C sur 13 retenus).
--
-- Données uniquement, avec WHERE : rien n'est supprimé, aucune table n'est modifiée.
-- Idempotent : une fois appliqué, plus aucune ligne ne correspond.

-- 1. Secteurs exclus : les nouveaux défauts (B2C quelle que soit la taille)
--    remplacent les anciens, SEULEMENT si le réglage n'a jamais été personnalisé.
update public.funnel_settings
set excluded_sectors = array['47', '55', '56', '96', '93', '8891', '862', '869', '812']::text[]
where excluded_sectors = array['4711', '4729', '812', '4742']::text[];

-- 2. Fiches écartées AU CREUSAGE (opposition à la prospection, aucun salarié,
--    capitaux propres) : elles restaient « retenu » avec un motif, et l'écran
--    les affichait « en attente de creusage ». Ce sont des rejets.
update public.signal_candidates
set statut = 'rejeté',
    motif_rejet = 'creusage : ' || motif_rejet
where statut = 'retenu'
  and (
    motif_rejet like 'opposition à la prospection%'
    or motif_rejet like 'aucun salarié déclaré%'
    or motif_rejet like 'capitaux propres%'
  );

-- 3. Fiches promues par le quota de variété : leur note était écrite dans
--    motif_rejet, et le creusage (qui ne prend que les fiches sans motif) les
--    sautait pour toujours. La note passe dans les badges, le motif est vidé :
--    elles seront re-filtrées avec les règles actuelles au prochain run.
update public.signal_candidates
set badges = array_append(coalesce(badges, '{}'::text[]), motif_rejet),
    motif_rejet = null
where statut = 'retenu'
  and motif_rejet like 'retenu pour la variété%';
