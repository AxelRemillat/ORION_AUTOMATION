import { candidateDomains } from "@/lib/contact-finder/free-site";
import { exclusionReason, isServiceProvider } from "@/lib/contact-finder/domains";

/**
 * RATTRAPAGE GRATUIT DES « SANS SITE » (Cowork #30) — code pur.
 *
 * L'étape « sites » essaie au plus 8 domaines déduits du nom, sous une échéance de temps.
 * Ici, hors préparation et sans échéance : plus de candidats (nom entier, sigle, enseigne,
 * ville), filtrés par le DNS (gratuit), puis UNE lecture de la page d'accueil. Un site
 * n'est gardé que si la correspondance est SÛRE : le nom ET (le SIREN, ou la ville / le
 * code postal). Ni Linkup, ni Hunter, ni modèle.
 */

export const MAX_RECOVERY_DOMAINS = 16;

export interface RecoveryCompany {
  names: readonly (string | null | undefined)[];
  siren: string | null;
  city: string | null;
  postalCode: string | null;
}

const LEGAL = /\b(sarl|sas|sasu|eurl|sa|sci|snc|selarl|scop|ets|etablissements?|societe|ste|groupe|holding|france)\b/g;
const STOP = new Set(["et", "de", "des", "du", "la", "le", "les", "l", "d", "en", "a", "au", "aux", "and", "sur"]);

export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const nameWords = (name: string) =>
  normalize(name.replace(/\(.*?\)/g, " "))
    .replace(LEGAL, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word));

/** Candidats du rattrapage : ceux de l'étape « sites », puis nom entier, sigle, mot + ville. */
export function recoveryDomains(company: RecoveryCompany): string[] {
  const out = candidateDomains(company.names, company.city);
  const push = (label: string) => {
    if (label.length < 3 || label.length > 40) return;
    for (const tld of ["fr", "com"]) if (!out.includes(`${label}.${tld}`)) out.push(`${label}.${tld}`);
  };
  const place = company.city ? nameWords(company.city).join("") : "";
  for (const name of company.names) {
    const words = nameWords(name ?? "");
    if (!words.length) continue;
    push(words.join(""));
    push(words.join("-"));
    if (words.length >= 3) push(words.map((word) => word[0]).join(""));
    if (place) push(`${words[0]}${place}`);
  }
  return out.filter((domain) => !exclusionReason(domain) && !isServiceProvider(domain)).slice(0, MAX_RECOVERY_DOMAINS);
}

export type MatchVerdict = { sure: true; by: "siren" | "ville" } | { sure: false; reason: string };

/** Correspondance d'une page d'accueil : le nom ET (le SIREN, ou la ville / le code postal). */
export function matchHomepage(html: string, company: RecoveryCompany): MatchVerdict {
  const text = ` ${normalize(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))} `;
  const named = company.names.some((name) => {
    const words = nameWords(name ?? "");
    return words.length > 0 && (text.includes(` ${words.join(" ")} `) || (words.length > 1 && text.includes(` ${words.join("")} `)) || (words.length === 1 && words[0].length >= 4 && text.includes(` ${words[0]} `)));
  });
  if (!named) return { sure: false, reason: "nom absent" };
  const siren = company.siren?.replace(/\D/g, "");
  if (siren && siren.length === 9 && text.replace(/ /g, "").includes(siren)) return { sure: true, by: "siren" };
  const city = company.city ? normalize(company.city) : "";
  if ((city && text.includes(` ${city} `)) || (company.postalCode && text.includes(` ${company.postalCode} `))) return { sure: true, by: "ville" };
  return { sure: false, reason: "nom seul (ni SIREN ni ville)" };
}

/** robots.txt : la page d'accueil est-elle interdite à tout robot (`User-agent: *` + `Disallow: /`) ? */
export function robotsForbidsHome(robots: string): boolean {
  let applies = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key)) applies = value === "*";
    else if (applies && /^disallow$/i.test(key) && value === "/") return true;
  }
  return false;
}
