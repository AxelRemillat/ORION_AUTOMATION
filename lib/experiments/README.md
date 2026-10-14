# Expériences sur les mails (Cowork #30)

Cadre pour comparer des **phrases d'appel à l'action** (CTA) sur les mails d'intro.
Ce cadre est **désactivé par défaut** : aucune expérience n'est créée ni activée.

## Ce qui change avec une expérience active

- À la rédaction d'un **nouveau** brouillon d'intro, `variantForDraft` tire une variante au hasard. Le tirage est équilibré : il prend la moins servie, et départage au hasard en cas d'égalité.
- Il enregistre la variante dans `mail_experiment_assignments`. Cette table est en insertion seule : une variante posée ne change plus.
- Un brouillon déjà rédigé, validé ou programmé garde sa variante, ou n'en a aucune s'il est né hors expérience. C'est vrai aussi quand on le régénère.
- La variante ne change **que la dernière phrase** du mail. `generateQualityDraft` reçoit `cta` (lib/emails/quality/generate.ts) :
  - pour F1, F2, F4 et F5, `cta` remplace `ctaFor(prospectId)` ;
  - pour F3, `fixedCta` remplace `F3_CTA` (families.ts) ;
  - les nombres de la phrase (« 2 minutes ») sont permis par les règles, comme ceux de l'offre.
- Sans expérience active, `cta` est absent et tout se passe exactement comme avant.

## Pour agent2 (rédaction, prompts, juge)

- **Ni les prompts ni le juge ne sont modifiés.** Le prompt du rédacteur reçoit `cta` comme avant ; c'est une donnée, pas une consigne nouvelle. Le juge note le mail complet avec la même grille, quelle que soit la variante.
- Pour F3, le prompt du rédacteur montre toujours `F3_CTA` dans son gabarit (writer.ts). Le mail assemblé, lui, finit par la phrase de la variante. Si tu veux que le rédacteur voie la vraie phrase, passe `cta` au gabarit F3 : c'est ton domaine, je n'y ai pas touché.
- Une phrase de variante doit rester **une seule question** finissant par « ? » : la règle « une seule question, et c'est le CTA » s'applique. `parseVariants` refuse les autres phrases.

## Activer, arrêter

```
npx tsx scripts/experience-mails.ts liste
npx tsx scripts/experience-mails.ts creer "Appel à l'action" "rdv=Auriez-vous 15 minutes la semaine prochaine pour en parler ?" "video=Voulez-vous que je vous envoie une vidéo de 2 minutes ?"
npx tsx scripts/experience-mails.ts activer <id>
npx tsx scripts/experience-mails.ts arreter <id>
```

- Une seule expérience peut être active à la fois (index unique).
- La date de début est posée à la première activation.

## Mesure

Le Cockpit affiche un encart par expérience (lib/experiments/stats.ts), avec par variante les envoyés, réponses, positives, refus et absences.

- Le comptage se fait par prospect.
- Une réponse rattachée par le fil ou l'adresse compte pour la variante de l'intro.
- Un avertissement reste affiché tant qu'une variante a moins de 50 envois.
