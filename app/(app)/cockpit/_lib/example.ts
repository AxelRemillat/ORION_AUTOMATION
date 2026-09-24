/**
 * Données d'EXEMPLE du Cockpit.
 *
 * Utilisées uniquement quand la base ne permet encore aucun calcul (portefeuille
 * vide). Elles servent à montrer à quoi ressemblera l'écran une fois alimenté.
 * Tout ce qui vient d'ici est affiché avec une mention « exemple » explicite —
 * ne jamais le présenter comme une donnée réelle, ni le mélanger à du réel.
 */
import type { FocusAction, SignalHighlight } from "./types";

export const EXAMPLE_FOCUS: FocusAction[] = [
  {
    id: "exemple-1",
    kind: "exemple",
    title: "Relancer une entreprise sans réponse depuis 5 jours",
    reason: "Les relances dues apparaîtront ici, les plus en retard d'abord",
    href: "/suivi",
    urgency: "haute",
  },
  {
    id: "exemple-2",
    kind: "exemple",
    title: "Traiter une réponse reçue",
    reason: "Un prospect passé au statut « Répondu » remonte automatiquement ici",
    href: "/suivi",
    urgency: "haute",
  },
  {
    id: "exemple-3",
    kind: "exemple",
    title: "Préparer l'approche du prospect le plus chaud",
    reason: "Classé par score de chaleur dès que des signaux sont enregistrés",
    href: "/recherche",
    urgency: "moyenne",
  },
];

export const EXAMPLE_SIGNALS: SignalHighlight[] = [
  {
    prospectId: "exemple-a",
    companyName: "Entreprise d'exemple",
    signal: {
      type: "levee",
      label: "Levée de fonds récente — budget disponible pour outiller",
      source: "Exemple",
    },
    score: {
      value: 78,
      level: "brulant",
      real: false,
      drivers: ["levee"],
      breakdown: [{ label: "Donnée d'exemple", points: 78, kind: "info" }],
    },
  },
  {
    prospectId: "exemple-b",
    companyName: "Autre entreprise d'exemple",
    signal: {
      type: "recrutement",
      label: "Recrute des postes ops/admin — tâches répétitives à outiller",
      source: "Exemple",
    },
    score: {
      value: 54,
      level: "chaud",
      real: false,
      drivers: ["recrutement"],
      breakdown: [{ label: "Donnée d'exemple", points: 54, kind: "info" }],
    },
  },
];
