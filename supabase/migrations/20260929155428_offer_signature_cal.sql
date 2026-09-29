-- Signature sans UTM et démo de 15 min vers le lien Cal.eu du site.
--
-- Ne touche QUE `public.user_offer`, et seulement les valeurs encore égales à
-- l'ancien défaut : un lien modifié à la main dans /offre n'est pas écrasé.
-- Idempotent : une fois appliqué, plus aucune ligne ne correspond.

-- 1. Signature : /pme sans paramètres (ses visites suffisent comme mesure).
update public.user_offer
set portfolio_url = 'https://axelremillat.com/pme',
    updated_at = now()
where portfolio_url = 'https://axelremillat.com/pme?utm_source=orion&utm_medium=email&utm_campaign=prospection';

-- 2. Démo de 15 min : le lien Cal.eu « appel découverte » du site, au lieu de /contact.
update public.user_offer
set entry_url = 'https://cal.eu/axel-remillat/appel-decouverte',
    updated_at = now()
where entry_url in ('https://axelremillat.com/contact', 'https://axelremillat.com/contact/');
