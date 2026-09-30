-- Démo de 15 min : lien Google Agenda du site au lieu de Cal.eu.
--
-- Ne touche QUE `public.user_offer`, et seulement si le lien vaut encore
-- l'ancien lien Cal.eu : un lien modifié à la main dans /offre n'est pas écrasé.
-- Idempotent : une fois appliqué, plus aucune ligne ne correspond.
update public.user_offer
set entry_url = 'https://calendar.app.google/dwAR7ea7tgAehwv48',
    updated_at = now()
where entry_url = 'https://cal.eu/axel-remillat/appel-decouverte';
