import { addresseeOf, civilityFor, isCompleteName, usagePerson, type Person } from "@/lib/emails/salutation";
import type { AskFn } from "@/lib/ai/chat";
import { isRoleAddress } from "@/lib/contact-finder/extract";
import { ownerMismatch } from "@/lib/contact-finder/owner";

/**
 * SALUTATION du gabarit qualité.
 *
 *   - adresse NOMINATIVE → son titulaire : « Bonjour Monsieur Lebreton, » ;
 *   - adresse GÉNÉRIQUE (contact@, secretariat@, info@…) → « Bonjour, », même si le dirigeant est connu
 *     (Cowork #59 : BEYNAT FERMETURES a refusé un « Bonjour Monsieur Rodriguez » reçu sur secretariat@) ;
 *   - sinon « Bonjour, ».
 *
 * Le 03/10, 1PACT (silouane.lebreton@) et KOMAKS (contact@, dirigeant Gradimir
 * Ivanov) ont reçu « Bonjour, » : leurs prénoms manquaient à la table des
 * civilités. Un prénom inconnu est désormais demandé UNE fois au modèle léger,
 * puis gardé sur la fiche (`key_figures.civilites`). Le modèle ne répond que
 * M, F ou « ? » ; « ? » laisse « Bonjour, » — mieux vaut neutre que faux.
 */

export type Civility = "Monsieur" | "Madame";
export type CivilityCache = Record<string, "M" | "F" | "?">;

const key = (first: string) =>
  first.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[-\s]/)[0] ?? "";

export interface GreetingInput {
  email: string | null | undefined;
  /** Dirigeant du registre (personne physique). */
  leaderPerson?: string | null;
  /** Contact nommé (Hunter, fiche). */
  contactName?: string | null;
  /** Dirigeant entrant que le mail interpelle (arrivée récente). */
  addressee?: string | null;
  /**
   * `contactName` EST le titulaire de `email` (contact nominatif choisi pour la
   * fiche) : à défaut de lire le nom dans l'adresse, c'est lui qu'on salue —
   * jamais le dirigeant, à qui on n'écrit pas (06/10/2026).
   */
  contactIsRecipient?: boolean;
  /**
   * `key_figures.addressee_hint` (agent1, #93) : la personne à viser quand
   * l'adresse reste GÉNÉRIQUE. `undefined` = fiche d'avant (jamais calculé) :
   * comportement d'avant ; `null` = calculé, personne à viser → « Bonjour, ».
   */
  addresseeHint?: { name: string; civility: Civility | null } | null;
}

/** Lit `key_figures.addressee_hint` ; `undefined` si le champ n'a jamais été posé. */
export function addresseeHintOf(figures: Record<string, unknown> | null | undefined): GreetingInput["addresseeHint"] {
  if (!figures || !("addressee_hint" in figures)) return undefined;
  const hint = figures.addressee_hint as { name?: unknown; civility?: unknown } | null;
  if (!hint || typeof hint.name !== "string" || !hint.name.trim()) return null;
  return { name: hint.name.trim(), civility: hint.civility === "Monsieur" || hint.civility === "Madame" ? hint.civility : null };
}

/** La personne à saluer, avec son prénom quand on le connaît. */
export function greetingPerson(input: GreetingInput): Person | null {
  // `aktid@aktid.fr` : la partie locale reprend le domaine, c'est une boîte de service.
  const [local = "", domain = ""] = (input.email ?? "").toLowerCase().split("@");
  const serviceBox = Boolean(local) && key(domain.split(".")[0] ?? "").replace(/[^a-z0-9]/g, "") === local.replace(/[^a-z0-9]/g, "");
  // Cowork #59 (BEYNAT FERMETURES, refus du 14/10 : « Bonjour Monsieur Rodriguez » à secretariat@) : une boîte
  // de rôle ou de service n'est lue par personne en particulier → « Bonjour, », jamais un nom.
  if (isRoleAddress(input.email) || serviceBox) return null;
  if (input.addressee) return usagePerson(input.addressee);
  // Contact nominatif choisi pour la fiche : son nom COMPLET, plutôt que ce que
  // l'adresse laisse deviner (« jmartin@ » ne donne pas le prénom).
  // … sauf s'il n'est visiblement PAS le titulaire de l'adresse (RISO FRANCE, Cowork #35 :
  // f.taoufik@ affiché au nom du dirigeant) : on salue alors le titulaire lu dans l'adresse.
  if (input.contactIsRecipient && input.contactName && ownerMismatch(input.email, input.contactName) !== true) {
    const recipient = usagePerson(input.contactName);
    if (recipient) return recipient;
  }
  const owner = addresseeOf(input.email);
  if (owner) {
    // Le titulaire de la boîte, nommé par son nom COMPLET quand on le connaît
    // ailleurs : c'est le prénom qui donne la civilité.
    const known = [input.contactName, input.leaderPerson]
      .map((name) => usagePerson(name))
      .find((person) => person && key(person.last) === key(owner.last));
    return known ?? owner;
  }
  // Ni boîte de rôle, ni nom lisible dans l'adresse (« xbr@ ») : personne de VÉRIFIÉ → « Bonjour, » (Cowork #59).
  if (local) return null;
  // Sans adresse (aperçu) : la personne visée par agent1 (Cowork #31), sinon le dirigeant.
  if (input.addresseeHint !== undefined) return input.addresseeHint ? usagePerson(input.addresseeHint.name) : null;
  return usagePerson(input.leaderPerson ?? input.contactName);
}

export function civilityOf(first: string, cache: CivilityCache = {}): Civility | null {
  if (!first.trim()) return null;
  const listed = civilityFor(first);
  if (listed) return listed;
  const cached = cache[key(first)];
  return cached === "M" ? "Monsieur" : cached === "F" ? "Madame" : null;
}

export function buildQualityGreeting(input: GreetingInput, cache: CivilityCache = {}): string {
  const person = greetingPerson(input);
  if (!person) return "Bonjour,";
  // La civilité donnée par agent1 pour la personne visée prime (adresse générique).
  const hinted = input.addresseeHint && usagePerson(input.addresseeHint.name)?.last === person.last ? input.addresseeHint.civility : null;
  const civility = hinted ?? civilityOf(person.first, cache);
  if (!civility) return "Bonjour,";
  // Nom coupé ou douteux (« Danancher- ») : la civilité seule, jamais un nom tronqué.
  return isCompleteName(person.last) ? `Bonjour ${civility} ${person.last},` : `Bonjour ${civility},`;
}

/** Prénom qu'il faudrait demander au modèle (inconnu de la table et du cache). */
export function unknownFirstName(input: GreetingInput, cache: CivilityCache = {}): string | null {
  const person = greetingPerson(input);
  if (!person?.first || person.first.length < 3) return null;
  if (civilityFor(person.first) || cache[key(person.first)]) return null;
  return person.first;
}

/** Une question, une réponse d'une lettre : quelques jetons au plus. */
export async function askCivility(ask: AskFn, first: string, last: string): Promise<"M" | "F" | "?"> {
  const raw = await ask(
    "judge",
    'Tu indiques le genre usuel d\'un prénom pour choisir « Monsieur » ou « Madame » dans un mail professionnel français. Réponds en JSON : {"genre":"M"} , {"genre":"F"} ou {"genre":"?"} si le prénom est mixte ou inconnu.',
    `Prénom : ${first}\nNom : ${last}`,
    0,
    "civilite",
  ).catch(() => "");
  try {
    const genre = (JSON.parse(raw) as { genre?: string }).genre;
    return genre === "M" || genre === "F" ? genre : "?";
  } catch {
    return "?";
  }
}

export const cacheKey = key;
