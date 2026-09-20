-- ===========================================================================
-- Purge des signaux web sans preuve
--
-- Avant le durcissement de lib/enrichment/signals.ts, un signal pouvait etre
-- emis sans qu'aucune source n'atteste l'evenement : des fiches portent donc
-- des libelles du type « Levee de fonds recente — budget disponible pour
-- outiller » pour des entreprises qui n'ont jamais leve. C'est de la fausse
-- donnee, et elle alimente les emails de prospection : on la supprime.
--
-- Critere de conservation, aligne sur le code :
--   - signal structurel (type = 'structure') : deduction assumee des donnees
--     INSEE/NAF, honnete, jamais presentee comme une actualite -> conserve ;
--   - signal web : conserve UNIQUEMENT s'il porte une citation (`quote`), une
--     URL verifiable et une confiance >= 0.6 -> le format d'apres correctif.
-- Tout le reste part.
--
-- Migration additive et idempotente : elle ne touche qu'a la colonne
-- prospects.signals, ne supprime aucune ligne, et peut etre rejouee.
-- ===========================================================================

update public.prospects
set signals = coalesce(
  (
    select jsonb_agg(signal)
    from jsonb_array_elements(signals) as signal
    where
      signal->>'type' = 'structure'
      or (
        coalesce(signal->>'quote', '') <> ''
        and coalesce(signal->>'url', '') <> ''
        and coalesce((signal->>'confidence')::numeric, 0) >= 0.6
      )
  ),
  '[]'::jsonb
)
where jsonb_typeof(signals) = 'array'
  and jsonb_array_length(signals) > 0
  -- Ne reecrire que les lignes qui contiennent effectivement un signal a purger.
  and exists (
    select 1
    from jsonb_array_elements(signals) as signal
    where signal->>'type' is distinct from 'structure'
      and (
        coalesce(signal->>'quote', '') = ''
        or coalesce(signal->>'url', '') = ''
        or coalesce((signal->>'confidence')::numeric, 0) < 0.6
      )
  );
