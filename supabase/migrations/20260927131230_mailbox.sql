-- ===========================================================================
-- Boîte mail du Cockpit : corbeille des mails reçus, réponse programmée dans
-- le même fil Gmail, « ne plus contacter » réversible
--
-- 1. `inbound_messages.deleted_at` — un mail reçu mis à la corbeille disparaît
--    de partout (Cockpit, actions du jour, compteurs) ; restaurable 14 jours,
--    puis purgé par le même cron que les prospects et les mails envoyés.
-- 2. `inbound_messages.gmail_message_id` — identifiant Gmail du mail reçu,
--    transmis par n8n : une réponse programmée s'y rattache.
-- 3. `messages.reply_to_inbound_id` / `reply_to_gmail_message_id` — la
--    réponse sait à quel mail elle répond : n8n la poste dans le même fil
--    (In-Reply-To), et le mail reçu est soldé quand elle part.
--    `messages.sent_to` : destinataire réel d'un mail parti (onglet « Envoyés »).
-- 4. `prospects.status_before_dnc` — statut rendu quand « ne plus contacter »
--    est levé (le prospect était passé en « perdu »).
--
-- Migration additive et idempotente : colonnes nullables, index.
-- ===========================================================================

alter table public.inbound_messages add column if not exists deleted_at timestamptz;
alter table public.inbound_messages add column if not exists gmail_message_id text;

alter table public.messages add column if not exists reply_to_inbound_id uuid
  references public.inbound_messages (id) on delete set null;
alter table public.messages add column if not exists reply_to_gmail_message_id text;
-- Destinataire réel d'un mail parti (manuel ou programmé) : l'onglet
-- « Envoyés » l'affiche. Les mails partis avant cette migration n'en ont pas.
alter table public.messages add column if not exists sent_to text;

alter table public.prospects add column if not exists status_before_dnc text;

-- Les écrans : « mes mails reçus vivants » et « ma corbeille ».
create index if not exists inbound_messages_user_deleted_idx
  on public.inbound_messages (user_id, deleted_at);
-- Le composeur : « la réponse en cours à ce mail reçu ».
create index if not exists messages_reply_to_inbound_idx
  on public.messages (reply_to_inbound_id)
  where reply_to_inbound_id is not null;
