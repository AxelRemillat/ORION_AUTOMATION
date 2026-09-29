-- UN SEUL NOM quand le sigle répète la dénomination.
--
-- L'annuaire public (champ `nom_complet`) accole le sigle entre parenthèses :
-- « GLOBAL 2F (GLOBAL 2F) ». Le nom s'affichait en double et un mail généré
-- a écrit « Global 2F Global 2F ». L'ingestion est corrigée
-- (lib/company-name.ts) ; cette migration nettoie les fiches déjà en base.
--
-- PORTÉE ÉTROITE : seules les fiches dont la parenthèse finale RÉPÈTE le nom
-- (même texte, casse ignorée) sont touchées. Un vrai sigle, différent du nom,
-- reste en place. Aucune information n'est perdue : le texte retiré est une
-- copie du texte gardé.
--
-- Idempotente : une fois nettoyé, le nom n'a plus de parenthèse finale et ne
-- correspond plus au filtre.
update public.prospects
set company_name = btrim(regexp_replace(company_name, '\s*\([^()]*\)\s*$', ''))
where company_name ~ '\([^()]*\)\s*$'
  and lower(btrim(regexp_replace(company_name, '\s*\([^()]*\)\s*$', '')))
    = lower(btrim(substring(company_name from '\(([^()]*)\)\s*$')))
  and btrim(regexp_replace(company_name, '\s*\([^()]*\)\s*$', '')) <> '';
