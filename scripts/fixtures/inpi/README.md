# Fixtures INPI (API RNE)

Réponses `GET /api/companies/{siren}` **réduites** aux champs utiles, construites
d'après la documentation INPI « Accéder aux formalités données saisies JSON »
(v4.0, juin 2025, annexe 1) : `formality.diffusionCommerciale` vaut `false`
quand l'entreprise s'oppose à la prospection.

| SIREN | Entreprise | Attendu |
| --- | --- | --- |
| 453450256 | SELECTION HABITAT | opposée |
| 898001029 | ADJUVOO | opposée |
| 520644386 | ARTFLEX | non opposée |

Ce ne sont PAS des réponses réelles : le compte INPI n'existait pas encore au
02/10/2026. Pour valider sur la vraie API (gratuite, aucun crédit) une fois
`INPI_USERNAME` / `INPI_PASSWORD` posées dans `.env.local` :

    npx tsx scripts/inpi-check.ts

Le script compare la réponse réelle à ce tableau et peut réécrire ces fichiers
avec la vraie réponse (`--write`).
