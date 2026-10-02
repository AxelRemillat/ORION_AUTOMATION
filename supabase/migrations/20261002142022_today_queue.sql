-- ===========================================================================
-- « Aujourd'hui » — file du jour préparée automatiquement
--
-- Chaque matin (ou à la demande), ORION prépare les fiches, les contacts et
-- les brouillons ; Axel relit, valide ou écarte, puis programme en une fois.
--
-- RÈGLE ABSOLUE DE CETTE MIGRATION : AUCUNE PERTE DE DONNÉES.
--   - aucune table supprimée, aucune colonne supprimée ni retypée ;
--   - aucune ligne supprimée ni réécrite ;
--   - uniquement des COLONNES AJOUTÉES (avec un défaut) et une TABLE NOUVELLE.
-- Les fiches, signaux, brouillons et historiques existants restent tels quels
-- et apparaissent dans le nouvel écran.
--
-- Pas de contrainte CHECK ajoutée sur les tables existantes : les bornes sont
-- appliquées par le code (lib/funnel/settings.ts), ce qui évite toute
-- validation rétroactive des lignes déjà en base.
--
-- Migration additive et idempotente.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Réglages : heure du run automatique, objectif de fiches prêtes par jour,
--    et jour du dernier run automatique (un seul run auto par jour).
--    `daily` (déjà présent) reste l'interrupteur : sa valeur n'est pas touchée.
-- --------------------------------------------------------------------------
alter table public.funnel_settings add column if not exists auto_hour smallint not null default 5;
alter table public.funnel_settings add column if not exists daily_target smallint not null default 25;
alter table public.funnel_settings add column if not exists last_auto_run_on date;

-- --------------------------------------------------------------------------
-- 2. Validation d'un brouillon dans « Aujourd'hui ».
--    Un brouillon validé n'est PAS envoyé : il attend la programmation groupée.
--    NULL pour tous les messages existants — rien ne change pour eux.
-- --------------------------------------------------------------------------
alter table public.messages add column if not exists validated_at timestamptz;

-- --------------------------------------------------------------------------
-- 3. Motifs d'écart saisis dans « Aujourd'hui ».
--    Un écart n'efface rien : la fiche, le brouillon et le signal restent en
--    base. La ligne sert à sortir l'élément de la file et aux statistiques de
--    l'entonnoir. « Annuler » renseigne `undone_at` plutôt que de supprimer.
-- --------------------------------------------------------------------------
create table if not exists public.prospect_discards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade default auth.uid(),
  prospect_id   uuid references public.prospects (id) on delete set null,
  message_id    uuid references public.messages (id) on delete set null,
  inbound_id    uuid references public.inbound_messages (id) on delete set null,
  candidate_id  uuid references public.signal_candidates (id) on delete set null,
  /** reponse | relance | nouveau | a_completer */
  kind          text not null,
  /** hors_cible | trop_grande | oppose | pas_de_besoin | mauvais_contact */
  reason        text not null,
  created_at    timestamptz not null default now(),
  undone_at     timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prospect_discards_kind_check') then
    alter table public.prospect_discards
      add constraint prospect_discards_kind_check
      check (kind in ('reponse', 'relance', 'nouveau', 'a_completer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'prospect_discards_reason_check') then
    alter table public.prospect_discards
      add constraint prospect_discards_reason_check
      check (reason in ('hors_cible', 'trop_grande', 'oppose', 'pas_de_besoin', 'mauvais_contact'));
  end if;
end
$$;

create index if not exists prospect_discards_user_idx
  on public.prospect_discards (user_id, created_at desc);
create index if not exists prospect_discards_prospect_idx
  on public.prospect_discards (prospect_id)
  where undone_at is null;

alter table public.prospect_discards enable row level security;

drop policy if exists "prospect_discards_owner" on public.prospect_discards;
create policy "prospect_discards_owner" on public.prospect_discards
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Sans GRANT, la policy ne sert à rien : PostgREST échoue en 42501 avant même
-- de l'évaluer. `anon` reste exclu ; `service_role` écrit depuis les jobs.
grant select, insert, update, delete on public.prospect_discards to authenticated, service_role;
