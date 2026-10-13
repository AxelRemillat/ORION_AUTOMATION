/**
 * Coût estimé d'une rédaction d'intro, affiché sur les boutons MANUELS (Cowork #56) — module sans dépendance,
 * importable côté client. Valeurs MESURÉES le 13/10/2026 (Cowork #54, lots de 11 fiches, stratège « low »,
 * raccourci sur le modèle léger) : ≈ 0,028 € avec le stratège, ≈ 0,02 € quand le brief stocké est réutilisé.
 * À remesurer avec `npx tsx scripts/cost-report.ts` si les modèles changent.
 */
export const FIRST_DRAFT_COST_EUR = 0.03;
export const REGEN_COST_EUR = 0.02;

/** « ≈ 0,02 € » */
export const costLabel = (eur: number): string => `≈ ${eur.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
