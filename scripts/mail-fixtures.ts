/**
 * Les 4 premiers mails de prospection partis le 28/09 (Gmail « Envoyés »),
 * RECONSTITUÉS à partir des défauts constatés : textes abrégés, adresses
 * fictives. Ce sont eux que le contrôle avant envoi doit arrêter.
 */

import { OPT_OUT_SENTENCE } from "../lib/mail-preflight/opt-out";

export const SIGNATURE = "Axel Remillat\nAutomatisation & IA pour PME · axelremillat.com";

/**
 * Les mails partis le 28/09 N'AVAIENT PAS la mention d'opposition : elle est
 * devenue obligatoire apres coup. Les fixtures la portent donc — sinon chaque
 * cas echouerait sur cette seule regle et masquerait le defaut qu'il illustre.
 */
const sign = (text: string) => `${text}\n\n${OPT_OUT_SENTENCE}\n\n${SIGNATURE}`;

export const SENT_0928 = {
  briol: {
    to: "contact@briol-diffusion.fr",
    website: "https://www.briol-diffusion.fr",
    known: ["contact@briol-diffusion.fr"],
    subject: "suivi des expéditions et stocks",
    body: sign(
      "Bonjour, Bonjour Monsieur Briol,\n\n" +
        "Avec vos showrooms, chaque demande de devis repasse par plusieurs mains avant de partir.\n\n" +
        "Je construis des automatisations qui préparent le devis dès la demande reçue.\n\n" +
        "Est-ce un sujet chez vous ?",
    ),
  },
  bonnin: {
    to: "contact@bonnin-freres.fr",
    website: "bonnin-freres.fr",
    known: ["contact@bonnin-freres.fr"],
    subject: "listes de préparation des boutiques",
    body: sign(
      "Bonjour,\n\nChaque matin, vos boutiques attendent leurs listes de préparation.\n\n" +
        "Je construis des flux qui les éditent seuls à partir des commandes.\n\nC'est encore manuel chez vous ?",
    ),
  },
  humanSight: {
    to: "m.durand@human-sight.fr",
    website: "human-sight.fr",
    known: ["m.durand@human-sight.fr"],
    subject: "fiches de cadrage sirh",
    body: sign(
      "Objet : automatisations sur vos missions SIRH\n\nBonjour Madame Durand,\n\n" +
        "Vos missions SIRH démarrent toutes par une fiche de cadrage.\n\n" +
        "Je construis des flux qui la pré-remplissent depuis l'appel d'offres.\n\nOn en parle 15 minutes ?",
    ),
  },
  selection: {
    to: "contact@selection-habitat.fr",
    website: "selection-habitat.fr",
    known: ["contact@selection-habitat.fr"],
    subject: "Devis de rénovation",
    body: sign(
      "Bonjour,\n\nChaque devis de rénovation se monte à la main depuis vos visites.\n\n" +
        "Je construis des flux qui partent de la visite pour préparer le devis.\n\nC'est un sujet ?",
    ),
  },
} as const;
