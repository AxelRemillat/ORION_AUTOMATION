-- Offre alignée sur le site refondu pour les PME (axelremillat.com).
--
-- Ne touche QUE `public.user_offer`, et seulement les valeurs encore égales à
-- l'ancien préremplissage : un lien ou une preuve modifiés à la main dans
-- /offre ne sont pas écrasés. Idempotent : une fois appliqué, plus aucune ligne
-- ne correspond aux anciennes valeurs.

-- 1. Lien de la signature : la page prospects, avec les UTM lus par Umami.
update public.user_offer
set portfolio_url = 'https://axelremillat.com/pme?utm_source=orion&utm_medium=email&utm_campaign=prospection',
    updated_at = now()
where portfolio_url in ('https://axelremillat.com', 'https://axelremillat.com/');

-- 2. Preuves : agent devis (5 métiers) et automatisations (fichiers clients).
update public.user_offer
set proofs = (
      select jsonb_agg(
        case
          when elem->>'id' = 'n8n'
           and elem->>'sentence' = '5 automatisations métier testables en direct sur mon site : tri d''e-mails, factures, SAV, comptes rendus, nettoyage de données.'
          then elem || jsonb_build_object(
            'title', '5 automatisations testables',
            'sentence', '5 automatisations testables en direct sur mon site : tri d''e-mails, factures, comptes rendus, fichiers clients, SAV.',
            'url', 'https://axelremillat.com/automatisations',
            'tags', '["e-mails", "factures", "SAV", "comptes rendus", "fichiers clients", "dossiers", "documents", "administratif", "données"]'::jsonb
          )
          when elem->>'id' = 'agent-devis'
           and elem->>'sentence' = 'Un agent qui transforme une demande client en devis, réponse et créneau, testable sur mon site.'
          then elem || jsonb_build_object(
            'title', 'Agent devis (5 métiers)',
            'sentence', 'Un agent qui transforme une demande client en devis chiffré, testable sur mon site sur 5 métiers : menuiserie, BTP, négoce B2B, boulangerie-traiteur, services B2B.',
            'url', 'https://axelremillat.com/agent'
          )
          else elem
        end
        order by position
      )
      from jsonb_array_elements(proofs) with ordinality as item(elem, position)
    ),
    updated_at = now()
where exists (
  select 1
  from jsonb_array_elements(proofs) as item(elem)
  where (elem->>'id' = 'n8n'
         and elem->>'sentence' = '5 automatisations métier testables en direct sur mon site : tri d''e-mails, factures, SAV, comptes rendus, nettoyage de données.')
     or (elem->>'id' = 'agent-devis'
         and elem->>'sentence' = 'Un agent qui transforme une demande client en devis, réponse et créneau, testable sur mon site.')
);
