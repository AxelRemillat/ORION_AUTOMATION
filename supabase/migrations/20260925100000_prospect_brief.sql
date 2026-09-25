-- Brief du stratège (lib/emails/strategist.ts), stocké avec le prospect.
--
-- Le brief fixe l'angle, le pain, la preuve et ce qu'il ne faut pas dire.
-- Il est conservé pour que « Autre angle » exclue l'angle précédent et que
-- « Réécrire depuis le brief » reparte des corrections faites à la main.
alter table public.prospects
  add column if not exists brief jsonb;
