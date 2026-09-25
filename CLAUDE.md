# CLAUDE.md — ORION (application PROSPECT)

Application de prospection freelance, mono-utilisateur. Next.js 14 (App Router),
TypeScript strict, Tailwind v3, Supabase.

Ce fichier remplace l'ancien `CONTRACT.md`, dont la moitié décrivait un
découpage en « Agent 1 / 2 / 3 » qui n'a plus cours : le dépôt n'est plus
partagé de cette façon, et la table de propriété des fichiers empêchait de
corriger un bug hors de son lot. Le reste — le design system — était juste et
est repris tel quel ci-dessous.

## Règles de travail

- **Aucune couleur en dur.** Pas de `#hex`, pas de `text-white`, pas de
  `bg-slate-800`. Uniquement les tokens ci-dessous, via les classes Tailwind ou
  `var(--token)`.
- **Ne jamais logger ni committer un secret.** Les clés vivent dans
  `.env.local`, qui est ignoré par git.
- **Supabase héberge aussi la production de VEGA** (table `ax_documents`).
  Interdiction absolue de `supabase db reset`, de tout `drop`/`alter` sur une
  table existante, et de toucher `ax_documents`. Les migrations sont
  **additives** et s'appliquent une par une.
- **Migrations** : `db.<ref>.supabase.co` ne résout qu'en IPv6 et n'est pas
  joignable depuis la machine de dev. Passer par le pooler IPv4
  (`aws-0-eu-west-1.pooler.supabase.com:5432`, utilisateur
  `postgres.<project-ref>`). Une policy RLS sans `GRANT` donne un `42501` :
  les deux vont toujours ensemble.
- **Ne jamais `npm run build` pendant un `next dev`** : `.next` est écrasé et la
  page devient blanche.

## Tests et scripts

Le harnais est sans dépendance : `tsc -p tsconfig.test.json` compile dans
`.test-build`, puis `node -r ./scripts/alias.cjs` résout l'alias `@/`.

| Commande | Ce qu'elle couvre |
| --- | --- |
| `npm test` | toutes les suites, à enchaîner avant de pousser |
| `npm run test:recherche` | zone, déduplication, boucle de scan, JSON-LD, couleurs canvas |
| `npm run test:emails` / `test:emails-extra` | validateurs et garde-fous de rédaction |
| `npm run eval:emails` | évaluation LLM sur fixtures (**consomme des appels payants**) |
| `npx tsx scripts/debug-search.ts [bloc]` | diagnostic recherche ; `live` et `bluefull` sont **payants** |

`tsc --noEmit`, `next lint`, `npm test` et `next build` doivent être verts avant
tout push.

---

## 1. Tokens de couleur

Deux familles, pour deux usages :

- **Tokens nommés** (`var(--surface)`, `var(--accent-grad)`…) — hex, rgba et
  dégradés. À utiliser en CSS, notamment pour les dégradés.
- **Classes Tailwind** (`bg-surface`, `text-muted`…) — adossées à des canaux
  RVB internes (`--rgb-*`), ce qui fait fonctionner les modificateurs
  d'opacité : `bg-surface-2/60`, `border-primary/25`.

> ⚠️ Tailwind v3 : l'échelle d'opacité va **de 5 en 5**. `bg-primary/12` ne
> génère **aucun CSS** et passe inaperçu. Utilisez `/10`, `/15`, `/20`…

### Surfaces et structure

| Token | Classe Tailwind | Rôle |
| --- | --- | --- |
| `--bg` | `bg-bg` | Fond de page (le dégradé est déjà posé sur `<body>`) |
| `--bg-grad` | `bg-app` | Dégradé de fond, brumeux |
| `--surface` | `bg-surface` | Cartes, tableaux, barre de nav |
| `--surface-2` | `bg-surface-2` | Fond secondaire : en-têtes de tableau, survol |
| `--elev` | `bg-elev` | Éléments flottants : modales, toasts |
| `--line` | `border-line` (alias `border-border`) | Bordure standard |
| `--line-soft` | `border-line-soft` | Séparateur interne, plus discret |
| `--shadow` | `shadow-mist` (alias `shadow-card`) | Ombre « brume » |

### Texte

| Token | Classe | Rôle |
| --- | --- | --- |
| `--text` | `text-text` (alias `text-fg`) | Texte principal |
| `--muted` | `text-muted` | Texte secondaire, libellés |
| `--faint` | `text-faint` | Métadonnées, placeholders |

### Marque (bleu-cyan)

| Token | Classe | Rôle |
| --- | --- | --- |
| `--primary` | `text-primary` / `bg-primary` (alias `accent`) | Couleur de marque |
| `--primary-strong` | `bg-primary-strong` | État appuyé |
| `--primary-soft` | — | Aplat très léger |
| `--cyan`, `--teal`, `--deep` | `text-cyan`, `bg-teal`, `text-deep` | Famille chromatique |
| `--accent-grad` | **`bg-brand-grad`** | Le dégradé signature |
| `--halo` | `bg-halo` | Halo lumineux |

### Sémantique — distincte de la marque

| Token | Classe | Sens |
| --- | --- | --- |
| `--good` | `bg-good` / `text-good` (alias `success`) | Gagné, positif |
| `--warn` | `bg-warn` / `text-warn` (alias `warning`) | Chaud, à traiter |
| `--lost` | `bg-lost` / `text-lost` (alias `danger`) | Perdu, erreur |

### Encres — pour du TEXTE sur un aplat teinté

Les couleurs sémantiques ci-dessus plafonnent à ~3:1 sur fond clair : elles
conviennent aux **remplissages**, pas au texte. Pour un libellé posé sur une
teinte, utilisez l'encre correspondante, qui passe AA dans les deux thèmes :

`text-primary-ink` · `text-cyan-ink` · `text-teal-ink` · `text-violet-ink`
`text-good-ink` · `text-warn-ink` · `text-lost-ink`

```tsx
// ✅ lisible en clair comme en sombre
<span className="rounded-full border border-good/25 bg-good/10 px-2 text-good-ink">Gagné</span>
// ❌ 2,9:1 sur fond clair
<span className="bg-good/10 text-good">Gagné</span>
```

### Utilitaires

| Classe | Effet |
| --- | --- |
| `bg-brand-grad` | Applique `--accent-grad` en fond |
| `text-brand-grad` | Texte peint par le dégradé |
| `shadow-mist` | Ombre douce du système |
| `font-data` | IBM Plex Mono + chiffres tabulaires |
| `scrollbar-thin` / `scrollbar-none` | Barres de défilement |

---

## 2. Typographie

| Famille | Classe | Usage |
| --- | --- | --- |
| Bricolage Grotesque | `font-display` | Titres (appliqué d'office à `h1/h2/h3`) |
| Instrument Sans | `font-sans` (défaut du `<body>`) | Texte courant |
| IBM Plex Mono | `font-mono` ou `font-data` | Chiffres, SIREN, dates, libellés techniques |

Tout ce qui est **chiffre comparable** (montants, compteurs, pourcentages)
prend `font-data` : la chasse fixe évite que les colonnes dansent.

---

## 3. Thème clair / sombre

Le thème vit dans `data-theme` sur `<html>` : absent = préférence système
(clair par défaut), `"light"` / `"dark"` = choix explicite mémorisé.

**Vous n'avez rien à faire** : en utilisant les tokens, vos écrans suivent le
thème automatiquement. N'écrivez pas de variante `dark:` — si une couleur ne
va pas dans un thème, c'est le token qu'il faut corriger (corrigez le token).

---

## 4. API des composants — `@/components/ui`

```tsx
import { Button, Card, PageHeader } from "@/components/ui";
```

| Composant | Props | Notes |
| --- | --- | --- |
| `Button` | `variant`: `primary` \| `secondary` \| `outline` \| `ghost` \| `danger` (déf. `primary`) · `size`: `sm` \| `md` \| `lg` \| `icon` (déf. `md`) · `loading?: boolean` · + props `<button>` | `primary` porte le dégradé : **une seule** par écran |
| `Input` | `error?: string` · + props `<input>` | `error` colore le champ et rend un `role="alert"` |
| `Label` | props `<label>` | Petites capitales, `font-data` |
| `Textarea` | props `<textarea>` | Redimensionnable en hauteur |
| `Select` | props `<select>` | Chevron fourni |
| `Card` | props `<div>` | + `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `StatCard` | `label: string` · `value: string \| number` · `hint?: string` · `className?` | Filet dégradé en tête |
| `Badge` | `tone`: `neutral` \| `accent` \| `success` \| `warning` \| `danger` \| `info` (déf. `neutral`) | Encres AA appliquées |
| `ProspectStatusBadge` | `status: ProspectStatus` | Libellé + couleur depuis `lib/constants.ts` |
| `DealStatusBadge` | `status: DealStatus` | idem |
| `Table` | props `<table>` | Défilement horizontal intégré ; avec `THead`, `TBody`, `TR`, `TH`, `TD` |
| `TableEmpty` | `colSpan: number` · `children` | Ligne « aucun résultat » |
| `Modal` | `open: boolean` · `onClose: () => void` · `title?` · `description?` · `footer?` · `size`: `sm` \| `md` \| `lg` | Échap + clic sur le fond ; scroll bloqué |
| `ToastProvider` / `useToast()` | `toast(msg, tone?)`, `success(msg)`, `error(msg)` | Le provider est **déjà monté** dans `app/(app)/layout.tsx` |
| `Skeleton` | `className?` | Chargement |
| `EmptyState` | `icon?` · `title: string` · `description?` · `action?` | État vide |
| `PageHeader` | `title: string` · `description?` · `actions?` | À placer en tête de chaque page |

Aucune de ces signatures n'a changé avec la refonte : vos écrans existants
continuent de fonctionner tels quels.

---

## 5. Navigation

La barre horizontale (`components/layout/top-nav.tsx`) lit `NAV_ITEMS` dans
`components/layout/nav-items.ts`. N'ajoutez pas d'entrée pour une route qui n'existe pas encore : le lien serait
mort.

Le contenu est rendu en pleine largeur (`max-w-[1600px]`) sous la barre.
Commencez chaque page par un `<PageHeader />`.

---

## 6. Graphiques

`lib/charts/palette.ts` lit aujourd'hui les variables `--accent`, `--success`,
`--info`, `--violet`, `--border`, `--fg`, `--warning`, `--danger` : elles sont
**maintenues** en triplets RVB et pointent sur la nouvelle palette. Ce fichier
continue donc de fonctionner.

Deux points à reprendre quand on touche ce fichier :

1. **`--muted` et `--teal` sont désormais des hex** (tokens publics du spec),
   plus des triplets. `rgb(#557488)` est invalide : lisez `--rgb-muted` et
   `--rgb-teal` à la place. Idem pour tous les autres : le namespace
   `--rgb-<nom>` est la source fiable pour Recharts.
2. Le `MutationObserver` surveille l'attribut `class` de `<html>`. Le sélecteur
   de thème pose bien une classe `theme-light` / `theme-dark` en plus de
   `data-theme`, donc la resynchronisation fonctionne — mais ajoutez
   `"data-theme"` à `attributeFilter` pour ne pas dépendre de ce détail.
