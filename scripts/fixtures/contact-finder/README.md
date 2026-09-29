# Fixtures du module contact (lib/contact-finder)

Pages HTML des trois cas réels qui ont motivé le module. Elles sont
**reconstituées** d'après la structure constatée à la main (domaine du site,
page où figure l'adresse, forme de l'adresse) : l'environnement cloud qui a
écrit ces tests n'avait pas d'accès réseau vers ces sites. Pour les comparer
au réel, lancer en local :

    npm run contact:live -- 421882440   # BRIOL DIFFUSION
    npm run contact:live -- 520644386   # ARTFLEX

Si une page réelle diffère, remplacer le fichier par le HTML enregistré
(`curl -A "OrionProspectBot/1.0" <url> > fichier.html`) et relancer
`npm run test:contact`.

`global2f/search.json` (GLOBAL 2F, SIREN 833040736, sans site) est lui aussi
**reconstitué** : les deux requêtes sont celles que produit le module, les
résultats ne sont que des annuaires et un réseau social. Pour le remplacer par
les vraies réponses :

    npx tsx scripts/record-contact-fixtures.ts 833040736
