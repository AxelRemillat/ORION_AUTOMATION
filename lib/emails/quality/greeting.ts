import { addresseeOf, civilityFor, isCompleteName, usagePerson, type Person } from "@/lib/emails/salutation";
import type { AskFn } from "@/lib/ai/chat";

/**
 * SALUTATION du gabarit qualité.
 *
 *   - adresse NOMINATIVE → son titulaire : « Bonjour Monsieur Lebreton, » ;
 *   - adresse GÉNÉRIQUE + dirigeant connu → le dirigeant : « Bonjour Monsieur Ivanov, » ;
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
}

/** La personne à saluer, avec son prénom quand on le connaît. */
export function greetingPerson(input: GreetingInput): Person | null {
  if (input.addressee) return usagePerson(input.addressee);
  // `aktid@aktid.fr` : la partie locale reprend le domaine, c'est une boîte de service.
  const [local = "", domain = ""] = (input.email ?? "").toLowerCase().split("@");
  const serviceBox = Boolean(local) && key(domain.split(".")[0] ?? "").replace(/[^a-z0-9]/g, "") === local.replace(/[^a-z0-9]/g, "");
  const owner = serviceBox ? null : addresseeOf(input.email);
  if (owner) {
    // Le titulaire de la boîte, nommé par son nom COMPLET quand on le connaît
    // ailleurs : c'est le prénom qui donne la civilité.
    const known = [input.contactName, input.leaderPerson]
      .map((name) => usagePerson(name))
      .find((person) => person && key(person.last) === key(owner.last));
    return known ?? owner;
  }
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
  const civility = civilityOf(person.first, cache);
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
