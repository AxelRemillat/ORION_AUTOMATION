-- Titre de la signature : « Automatisation & IA pour PME », sans « en production ».
--
-- Le site parle aux PME d'automatisation, plus de « mise en production ». Ne
-- touche QUE public.user_offer, et seulement si le titre vaut encore l'ancien
-- défaut : un titre personnalisé dans /offre n'est pas écrasé. Idempotent.
update public.user_offer
set title = 'Automatisation & IA pour PME',
    updated_at = now()
where title = 'Automatisation & IA en production pour PME';
