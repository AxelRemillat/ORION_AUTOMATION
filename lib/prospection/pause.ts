/**
 * Pause de la prospection par e-mail (refonte CRM, Cowork #117, décision d'Axel du 18/11/2026).
 *
 * Un seul drapeau, `PROSPECTION_EMAIL_ACTIVE` : il faut écrire exactement `true` pour réactiver. Absent, vide ou
 * toute autre valeur = EN PAUSE. Pendant la pause, rien de la prospection ne coûte ni n'envoie :
 *
 *  - préparation automatique de 5 h et « Lancer maintenant » (jobs refusés à la création, jamais dépilés) ;
 *  - rédaction et régénération des mails (jobs `email_generate` / `email_rewrite`) ;
 *  - envois programmés : premiers mails ET relances (`runDueSends` n'est plus appelé par le tick) ;
 *  - appels payants Hunter, Pappers et Linkup, coupés au plus près de la requête HTTP (contrôle placé juste
 *    après celui de la clé : l'appelant suit le même chemin « source indisponible » qu'en l'absence de clé).
 *
 * Restent actifs : la réception des réponses (`/api/inbound`), la veille Upwork/ComeUp par e-mail, Opportunités,
 * le CRM. Rien n'est supprimé : files, brouillons, historique et prospects restent en base.
 */

export const PROSPECTION_EMAIL_FLAG = "PROSPECTION_EMAIL_ACTIVE";

/** Message unique, repris par les routes (HTTP 423) et les erreurs de job. */
export const PROSPECTION_EN_PAUSE =
  "Prospection par e-mail en pause (PROSPECTION_EMAIL_ACTIVE=false) : aucun appel payant ni envoi.";

/** `true` seulement si la variable vaut exactement « true » (insensible à la casse et aux espaces). */
export function prospectionEmailActive(env: Record<string, string | undefined> = process.env): boolean {
  return (env[PROSPECTION_EMAIL_FLAG] ?? "").trim().toLowerCase() === "true";
}

/** Services payants coupés pendant la pause (journalisés une fois par service et par processus). */
export type ServicePayant = "hunter" | "pappers" | "linkup";
const signales = new Set<ServicePayant>();

/**
 * `true` = l'appel payant peut partir. À placer juste avant la requête HTTP d'un service payant de la prospection.
 * Pendant la pause, renvoie `false` sans réseau ni base.
 */
export function appelPayantAutorise(service: ServicePayant, env: Record<string, string | undefined> = process.env): boolean {
  if (prospectionEmailActive(env)) return true;
  if (!signales.has(service)) {
    signales.add(service);
    console.info(`[pause-prospection] appel ${service} bloqué : ${PROSPECTION_EN_PAUSE}`);
  }
  return false;
}

/** Erreur « en pause » au format des clients payants (`{ ok: false, error }`). */
export const erreurPause = (service: ServicePayant) => `${service} : ${PROSPECTION_EN_PAUSE}`;

/**
 * Garde des routes API de la prospection : `null` si elle est active, sinon une réponse HTTP 423 (« Locked ») au
 * format habituel des routes (`{ error }`). Usage : `const pause = refusSiPause(); if (pause) return pause;`
 */
export function refusSiPause(env: Record<string, string | undefined> = process.env): Response | null {
  if (prospectionEmailActive(env)) return null;
  return new Response(JSON.stringify({ error: PROSPECTION_EN_PAUSE, paused: true }), {
    status: 423,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
