-- ===========================================================================
-- Contrôle avant envoi (28/09 : double salutation, objet collé dans le corps,
-- objets incohérents sur les 4 premiers mails).
--
-- 1. `send_status = 'blocked'` : le tick a refusé de faire partir un mail qui
--    échoue au contrôle avant envoi. Motif dans `send_error`, visible dans
--    « Programmés ». Aucun envoi, aucune reprise automatique.
-- 2. `mail_subject_checks` : cache du verdict LLM « objet cohérent avec le
--    corps », par empreinte objet + corps (un appel par version du mail).
--
-- Additive et idempotente. La contrainte de `send_status` est remplacée par
-- une version qui ACCEPTE une valeur de plus : aucune ligne existante n'est
-- touchée, les mails programmés (relances du 2 oct. comprises) restent tels quels.
-- ===========================================================================

alter table public.messages drop constraint if exists messages_send_status_check;
alter table public.messages
  add constraint messages_send_status_check
  check (send_status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled', 'blocked'));

create table if not exists public.mail_subject_checks (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hash       text not null,
  coherent   boolean not null,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, hash)
);

alter table public.mail_subject_checks enable row level security;

drop policy if exists "mail_subject_checks_owner" on public.mail_subject_checks;
create policy "mail_subject_checks_owner" on public.mail_subject_checks
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.mail_subject_checks to authenticated, service_role;
