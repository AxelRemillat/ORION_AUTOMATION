-- Opportunités : statut « fermee » (Cowork #21) — projet fermé, attribué ou annulé
-- avant qu'Axel ait postulé. Idempotent : la contrainte est remplacée par la même
-- liste augmentée de « fermee ». Aucune donnée touchée.
alter table public.opportunities drop constraint if exists opportunities_status_check;
alter table public.opportunities
  add constraint opportunities_status_check
  check (status in ('a_repondre', 'envoyee', 'reponse', 'entretien', 'gagnee', 'perdue', 'fermee', 'ignoree'));
