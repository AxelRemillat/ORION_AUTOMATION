/**
 * Un dirigeant qui vient d'arriver, et ce qu'on lui écrit.
 *
 * C'est le meilleur moment de prospection qui existe : ses premiers mois sont
 * ceux où il remet à plat les outils et les process, parce qu'il les découvre
 * et qu'on ne lui reprochera pas de changer ce qu'il n'a pas mis en place.
 *
 * Deux conséquences, et le mail les manquait toutes les deux :
 *
 *   - il faut lui écrire À LUI, nominativement. Un « Bonjour, » impersonnel sur
 *     une nomination récente est un contresens ;
 *   - l'angle n'est pas son secteur mais sa situation : « premiers mois =
 *     remise à plat ».
 *
 * Sans dépendance réseau : la recherche d'adresse reste à l'appelant.
 */

export interface IncomingLeader {
  fullName: string;
  firstName: string;
  lastName: string;
  role: string | null;
  /** Date de la nomination, quand elle est connue. */
  since: string | null;
}

/**
 * Au-delà, ce n'est plus une arrivée : c'est un dirigeant en poste.
 * Douze mois laissent le temps d'un cycle budgétaire complet.
 */
export const RECENT_APPOINTMENT_MONTHS = 12;

const capitalize = (value: string): string =>
  value
    .split(/([-\s])/)
    .map((part) => (/[-\s]/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");

/**
 * Lit un dirigeant entrant depuis les chiffres clés.
 *
 * Deux sources, dans cet ordre :
 *
 *   - `new_leader_name` : le dirigeant NOMMÉ par l'annonce BODACC qui a fait
 *     remonter la fiche. C'est la source la plus explicite — l'annonce dit
 *     « nomination de… » — et sa date est celle du signal ;
 *   - `leader` / `leader_person` avec `leader_since` : la date de prise de
 *     poste publiée par Pappers. Elle vaut pour tout dirigeant, entrant ou
 *     installé ; c'est l'appelant qui décide si douze mois sont dépassés.
 *
 * L'annuaire et Pappers renvoient les noms en capitales — « DUMONT »,
 * « BENJAMIN ALEXANDRE ». On ne garde que le PREMIER prénom : les suivants ne
 * servent qu'à l'état civil, et « Bonjour Benjamin Alexandre » ne se dit pas.
 */
export function readIncomingLeader(figures: Record<string, unknown>): IncomingLeader | null {
  const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  // `incoming_leader` reste accepté : c'est la clé qu'utilisent les fixtures.
  const fromSignal = str(figures.new_leader_name) ?? str(figures.incoming_leader);
  const name = fromSignal ?? str(figures.leader_person) ?? str(figures.leader);
  if (!name || name.split(/\s+/).length < 2) return null;

  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = capitalize(parts[0]);
  const lastName = capitalize(parts[parts.length - 1]);
  const role = fromSignal
    ? str(figures.new_leader_role) ?? str(figures.incoming_leader_role)
    : str(figures.leader_role);
  const since = fromSignal
    ? str(figures.signal_date) ?? str(figures.incoming_leader_since)
    : str(figures.leader_since);

  return { fullName: `${firstName} ${lastName}`, firstName, lastName, role, since };
}

/**
 * Fonctions qui DIRIGENT reellement l'entreprise.
 *
 * Un administrateur, un commissaire aux comptes ou un membre du conseil de
 * surveillance entre au registre sans prendre la direction de quoi que ce soit.
 * Constate sur ELYCOOP (69) le 26/09/2026 : « Besma HATHROUBI devient
 * administrateur » ouvrait un mail sur « vous avez pris la direction de… », ce
 * qui est faux — et faux des la premiere ligne, c'est le pire endroit.
 *
 * Une fonction inconnue reste acceptee : le premier representant publie par
 * Pappers est le dirigeant dans la quasi-totalite des cas.
 */
const LEADING_ROLES = /g[eé]rant|pr[eé]sident|directeur|directrice|direction|pdg|dirigeant/i;

export function leadsTheCompany(role: string | null | undefined): boolean {
  if (!role || !role.trim()) return true;
  return LEADING_ROLES.test(role);
}

/**
 * Le dirigeant du moment, uniquement s'il vient d'arriver.
 *
 * Rend `null` pour un dirigeant en poste depuis des années : son arrivée n'est
 * plus une nouvelle, et ouvrir un mail sur elle se retourne contre nous.
 */
export function incomingLeader(
  figures: Record<string, unknown>,
  now = new Date(),
): IncomingLeader | null {
  const leader = readIncomingLeader(figures);
  if (!leader || !isRecentAppointment(leader.since, now)) return null;
  return leadsTheCompany(leader.role) ? leader : null;
}

/** La nomination est-elle assez récente pour porter l'accroche ? */
export function isRecentAppointment(since: string | null, now = new Date()): boolean {
  if (!since) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - RECENT_APPOINTMENT_MONTHS);
  return since >= limit.toISOString().slice(0, 10);
}

/**
 * Consigne d'angle pour un dirigeant entrant.
 *
 * Volontairement une CONSIGNE et non une phrase toute faite : deux mails qui
 * ouvrent mot pour mot pareil se repèrent immédiatement. Le rédacteur met en
 * mots, la règle fixe le fond.
 */
export function incomingLeaderAngle(leader: IncomingLeader, companyName: string): string {
  const role = leader.role ? `${leader.role} de ` : "la direction de ";
  return (
    `${leader.fullName} a pris ${role}${companyName} récemment. Ouvre sur CE fait — ` +
    "« vous avez pris la direction de… » — puis sur ce qu'il implique : les premiers " +
    "mois sont ceux où l'on remet à plat les outils et les process, avant que les " +
    "habitudes ne se réinstallent."
  );
}

/**
 * Requête Hunter email-finder pour un dirigeant nommé.
 *
 * `domain` + prénom + nom : c'est la forme qui donne les meilleurs taux, bien
 * meilleurs que la recherche par domaine seul, qui rend l'adresse générique.
 */
export interface LeaderEmailQuery {
  domain: string;
  firstName: string;
  lastName: string;
}

export function leaderEmailQuery(
  leader: IncomingLeader,
  website: string | null | undefined,
): LeaderEmailQuery | null {
  if (!website) return null;
  let domain: string;
  try {
    domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (!domain.includes(".")) return null;
  return { domain, firstName: leader.firstName, lastName: leader.lastName };
}

/**
 * Une offre France Travail de moins de 30 jours est un signal fort.
 *
 * Le poste recruté dit quelle tâche déborde AUJOURD'HUI. On relie donc le flux
 * à cette tâche — et jamais à la personne : proposer d'automatiser ce qu'on
 * vient d'embaucher quelqu'un pour faire est le meilleur moyen de se fermer la
 * porte.
 */
export const FRESH_JOB_DAYS = 30;

/** Tâche automatisable qui accompagne un poste, par famille de métier. */
const ROLE_TO_TASK: { pattern: RegExp; task: string }[] = [
  { pattern: /assistant[e]?\s*adv|administration des ventes|gestionnaire adv/i, task: "la saisie et le suivi des commandes" },
  { pattern: /comptab|facturation|credit manager/i, task: "le rapprochement des factures et les relances" },
  { pattern: /assistant[e]?\s*(administratif|de direction)|secretaire/i, task: "la production des documents et le classement" },
  { pattern: /planificateur|ordonnancement|methodes/i, task: "la planification et les ordres de fabrication" },
  { pattern: /logistique|approvisionn|magasinier|supply/i, task: "le suivi des expéditions et des stocks" },
  { pattern: /service client|sav|reclamation|support/i, task: "la qualification des demandes entrantes" },
  { pattern: /rh\b|paie|recrut/i, task: "les dossiers du personnel et les relances de pièces" },
  { pattern: /automaticien|robotique|process/i, task: "le lien entre les alertes machine et les interventions" },
  { pattern: /data|analyst|reporting/i, task: "la consolidation des données et le reporting" },
];

export interface FreshJobHook {
  title: string;
  task: string;
  date: string;
}

/**
 * Accroche tirée d'une offre récente.
 *
 * `null` quand le poste ne se rattache à aucune tâche connue : on préfère ne
 * rien dire plutôt que d'inventer un lien entre un poste et un flux.
 */
export function freshJobHook(
  signal: { label?: string; jobTitle?: unknown; date?: unknown },
  now = new Date(),
): FreshJobHook | null {
  const date = typeof signal.date === "string" ? signal.date : null;
  if (!date) return null;

  const limit = new Date(now);
  limit.setDate(limit.getDate() - FRESH_JOB_DAYS);
  if (date < limit.toISOString().slice(0, 10)) return null;

  const title =
    typeof signal.jobTitle === "string" && signal.jobTitle.trim()
      ? signal.jobTitle.trim()
      : /^Poste ouvert\s*:\s*(.+?)\s+—/.exec(signal.label ?? "")?.[1]?.trim() ?? null;
  if (!title) return null;

  const matched = ROLE_TO_TASK.find((entry) => entry.pattern.test(title));
  return matched ? { title, task: matched.task, date } : null;
}

/**
 * Le capital a-t-il RÉELLEMENT augmenté ?
 *
 * Un capital élevé n'est pas une augmentation. Sans capital précédent
 * strictement inférieur confirmé par Pappers, on ne parle pas de capital — la
 * formule « votre récente augmentation de capital » sur une société qui n'a
 * jamais bougé est une erreur qui se voit immédiatement.
 */
export function capitalIncreased(
  current: number | null | undefined,
  previous: number | null | undefined,
): boolean {
  if (typeof current !== "number" || !Number.isFinite(current)) return false;
  if (typeof previous !== "number" || !Number.isFinite(previous)) return false;
  return previous > 0 && current > previous;
}
