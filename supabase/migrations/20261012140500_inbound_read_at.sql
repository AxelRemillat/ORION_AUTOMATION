-- ===========================================================================
-- « Lu / non lu » des mails reçus — une notion À PART de `handled`
--
-- `handled` veut dire « soldé » : une réponse est partie, ou un challenge
-- anti-spam a été validé. C'est ce drapeau qui sort un mail de la file
-- d'« Aujourd'hui » (lib/today/load.ts) et de la préparation des réponses
-- (lib/jobs/handlers/prepare.ts). Le détourner pour dire « Axel a lu » ferait
-- disparaître de sa file du jour tout mail resté 2 secondes à l'écran.
--
-- D'où une colonne dédiée : `read_at`. Elle ne pilote RIEN d'autre que
-- l'affichage (point « non lu », compteur « N non lu », badge de la boîte
-- mail). Aucune suppression, aucune colonne touchée.
--
-- Reprise de l'existant : un mail déjà soldé a forcément été lu — sans ce
-- rattrapage, le compteur afficherait d'un coup tout l'historique en « non lu ».
-- ===========================================================================

alter table public.inbound_messages
  add column if not exists read_at timestamptz;

comment on column public.inbound_messages.read_at is
  'Instant où Axel a lu le mail dans la boîte mail (affichage seul). NULL = non lu. Distinct de handled, qui veut dire « soldé » et pilote la file du jour.';

-- Rattrapage, une seule fois : les mails déjà soldés passent pour lus.
-- `read_at is null` rend l'instruction rejouable sans rien écraser.
update public.inbound_messages
  set read_at = coalesce(created_at, received_at)
  where handled = true
    and read_at is null;

-- Le compteur « non lus » : les non lus vivants d'un utilisateur, récents d'abord.
create index if not exists inbound_messages_unread_idx
  on public.inbound_messages (user_id, received_at desc)
  where read_at is null and deleted_at is null;
