/**
 * CONTACT NOMINATIF, choisi selon le SUJET du mail — 06/10/2026.
 *
 * Constat : la plupart des mails partaient sur contact@, commercial@, info@.
 * On écrit désormais à la PERSONNE dont la fonction correspond au sujet
 * (pain) du brouillon : un mail sur les devis va au directeur commercial, un
 * mail sur les factures au DAF ; dans une entreprise de moins de 20 salariés,
 * au dirigeant d'abord.
 *
 * Stratégie Hunter, par domaine (chaque appel passe par le garde-fou
 * lib/hunter/gate.ts : cache 90 jours, budget du jour) :
 *   a) Domain Search filtré (type personnel, départements utiles) → le meilleur
 *      poste correspondant au rôle visé, confiance Hunter ≥ 80 ;
 *   b) sinon (ou si son adresse ne passe pas la vérification) Email Finder sur
 *      le dirigeant (nom d'usage, cf. names.ts) ;
 *   c) Email Verifier sur l'adresse retenue : « valid » gardé ; « accept_all »
 *      seulement si confiance ≥ 90 ; sinon on n'en change pas ;
 *   d) rien de sûr : l'adresse générique reste (dernier recours).
 *
 * Module PUR : le réseau passe par `NominativeDeps`, les tests le simulent.
 */

export type TopicKey = "commercial" | "finance" | "service" | "admin" | "general";
export type RoleKey = "commercial" | "adv" | "finance" | "comptable" | "service_client" | "office" | "admin" | "dirigeant";

export interface RoleTarget {
  key: RoleKey;
  label: string;
  /** Postes Hunter (texte libre) reconnus pour ce rôle. */
  pattern: RegExp;
  /** Départements Hunter où le chercher. */
  departments: string[];
}

const ROLES: Record<RoleKey, RoleTarget> = {
  commercial: {
    key: "commercial",
    label: "directeur commercial",
    pattern: /(directeur|directrice|responsable|head of|chief|vp)\b.{0,20}(commercial|ventes?|sales|business development)|sales (director|manager)|commercial (director|manager)|\bcco\b|key account manager/i,
    departments: ["sales", "management"],
  },
  adv: {
    key: "adv",
    label: "responsable ADV",
    pattern: /\badv\b|administration des ventes|sales administration|order management|customer service manager|responsable (des )?commandes/i,
    departments: ["sales", "support", "operations"],
  },
  finance: {
    key: "finance",
    label: "DAF",
    pattern: /\bdaf\b|\bcfo\b|directeur (administratif et )?financier|directrice (administrative et )?financi[eè]re|finance (director|manager)|head of finance|chief financial|responsable financier/i,
    departments: ["finance", "management"],
  },
  comptable: {
    key: "comptable",
    label: "responsable comptable",
    pattern: /comptab|accounting|accountant|controller|contr[ôo]leur de gestion|responsable administratif|administrati(f|ve) et financ/i,
    departments: ["finance"],
  },
  service_client: {
    key: "service_client",
    label: "responsable service client",
    pattern: /service client|relation client|customer (service|success|care|support)|\bsav\b|apr[eè]s[- ]vente|support manager/i,
    departments: ["support", "operations"],
  },
  office: {
    key: "office",
    label: "office manager",
    pattern: /office manager|assistante? de direction|executive assistant|responsable des services g[ée]n[ée]raux/i,
    departments: ["management", "operations"],
  },
  admin: {
    key: "admin",
    label: "responsable administratif",
    pattern: /responsable administrati|directeur administratif|directrice administrative|administrative (director|manager)|\bdg\b|directeur g[ée]n[ée]ral adjoint/i,
    departments: ["management", "finance"],
  },
  dirigeant: {
    key: "dirigeant",
    label: "dirigeant",
    pattern: /\b(ceo|pdg|p\.d\.g|dg|g[ée]rante?|pr[ée]sidente?|fondat(eur|rice)|founder|co-?founder|owner|directeur g[ée]n[ée]ral|directrice g[ée]n[ée]rale|managing director|general manager|dirigeant)\b/i,
    departments: ["executive", "management"],
  },
};

// L'ORDRE COMPTE : « tri des demandes et commandes reçues par e-mail » est un
// sujet service client, pas commercial — le tri passe donc avant les commandes.
const TOPICS: { key: TopicKey; pattern: RegExp; roles: RoleKey[] }[] = [
  { key: "finance", pattern: /factur|paiement|r[èe]glement|relances? (de |des )?(paiement|impay)|impay|comptab|tr[ée]sorerie|recouvrement/i, roles: ["finance", "comptable", "dirigeant"] },
  { key: "service", pattern: /\bsav\b|service client|r[ée]clamation|tri (des|de leurs) (e-?mails?|demandes|mails)|bo[iî]te (mail|de r[ée]ception)|demandes clients|apr[eè]s[- ]vente|support/i, roles: ["service_client", "adv", "office", "dirigeant"] },
  { key: "commercial", pattern: /devis|chiffrage|cotation|demandes? de prix|tarif|commandes?|\badv\b|administration des ventes|offres? commerciales?/i, roles: ["commercial", "adv", "dirigeant"] },
  { key: "admin", pattern: /compte[s]?[- ]rendus?|reporting|documents?|fichier clients?|crm|saisie|base clients|tableaux? de bord/i, roles: ["dirigeant", "admin"] },
];

/** Sujet du mail, lu dans le pain du brouillon. */
export function topicOf(pain: string | null | undefined): TopicKey {
  const text = pain ?? "";
  return TOPICS.find((topic) => topic.pattern.test(text))?.key ?? "general";
}

/**
 * Rôles visés, dans l'ordre. Moins de 20 salariés : le dirigeant d'abord,
 * quel que soit le sujet (il fait tout lui-même, et c'est lui qui décide).
 */
export function targetRoles(pain: string | null | undefined, headcount: number | null | undefined): RoleTarget[] {
  const topic = TOPICS.find((item) => item.key === topicOf(pain));
  const order: RoleKey[] = topic ? [...topic.roles] : ["dirigeant"];
  if (typeof headcount === "number" && headcount < 20) {
    return [ROLES.dirigeant, ...order.filter((key) => key !== "dirigeant").map((key) => ROLES[key])];
  }
  return order.map((key) => ROLES[key]);
}

export interface HunterPerson {
  email: string;
  type: "personal" | "generic" | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  /** Confiance Hunter, 0–100. */
  confidence: number | null;
  department: string | null;
  seniority: string | null;
}

export type VerifierStatus = "valid" | "accept_all" | "invalid" | "unknown" | "disposable" | "webmail";

export interface NominativeDeps {
  domainSearch(domain: string, filters: { departments: string[] }): Promise<HunterPerson[] | null>;
  emailFinder(domain: string, firstName: string, lastName: string): Promise<{ email: string; score: number | null; position: string | null } | null>;
  verify(email: string): Promise<{ status: VerifierStatus; score: number | null } | null>;
}

export interface NominativeInput {
  domain: string;
  pain: string | null;
  headcount: number | null;
  /** Dirigeant, NOM D'USAGE (names.ts / salutation.ts). */
  leader: { firstName: string; lastName: string } | null;
  /** Adresses à ne jamais retenir (liste « ne plus contacter »). */
  blocked?: string[];
}

export interface NominativeContact {
  email: string;
  name: string | null;
  /** Poste Hunter, sinon le libellé du rôle visé. */
  role: string;
  roleKey: RoleKey;
  /** « hunter:domain-search » ou « hunter:email-finder ». */
  source: string;
  /** Confiance retenue (Hunter / vérification), 0–100. */
  confidence: number;
  verifier: VerifierStatus;
}

export interface NominativeOutcome {
  contact: NominativeContact | null;
  /** Rôles visés, dans l'ordre. */
  targets: RoleKey[];
  calls: { domainSearch: number; finder: number; verifier: number };
  steps: string[];
}

const MIN_SEARCH_CONFIDENCE = 80;
const MIN_ACCEPT_ALL_CONFIDENCE = 90;

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/** L'adresse (ou le nom Hunter) est-elle celle du dirigeant ? */
export function isLeader(person: Pick<HunterPerson, "email" | "lastName">, leader: NominativeInput["leader"]): boolean {
  if (!leader) return false;
  const last = fold(leader.lastName);
  if (last.length < 3) return false;
  return fold(person.lastName ?? "") === last || fold(person.email.split("@")[0]).includes(last);
}

const fullName = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ").trim() || null;

export async function findNominativeContact(input: NominativeInput, deps: NominativeDeps): Promise<NominativeOutcome> {
  const targets = targetRoles(input.pain, input.headcount);
  const outcome: NominativeOutcome = { contact: null, targets: targets.map((target) => target.key), calls: { domainSearch: 0, finder: 0, verifier: 0 }, steps: [] };
  const blocked = new Set((input.blocked ?? []).map((email) => email.toLowerCase()));
  const departments = [...new Set(targets.flatMap((target) => target.departments))];

  // a) Domain Search : candidats avec poste, classés par rôle visé puis confiance.
  outcome.calls.domainSearch += 1;
  const people = ((await deps.domainSearch(input.domain, { departments })) ?? []).filter(
    (person) => person.type !== "generic" && person.email.includes("@") && !blocked.has(person.email.toLowerCase()),
  );
  outcome.steps.push(`domain-search ${input.domain} [${departments.join(",")}] : ${people.length} personne(s)`);
  type Pick = { person: HunterPerson; target: RoleTarget; rank: number };
  const picks: Pick[] = [];
  targets.forEach((target, rank) => {
    for (const person of people) {
      if ((person.confidence ?? 0) < MIN_SEARCH_CONFIDENCE) continue;
      const matches = target.pattern.test(person.position ?? "") || (target.key === "dirigeant" && isLeader(person, input.leader));
      if (matches && !picks.some((pick) => pick.person.email === person.email)) picks.push({ person, target, rank });
    }
  });
  picks.sort((a, b) => a.rank - b.rank || (b.person.confidence ?? 0) - (a.person.confidence ?? 0));

  type Candidate = { email: string; name: string | null; role: string; roleKey: RoleKey; source: string; confidence: number };
  const tryVerify = async (candidate: Candidate): Promise<boolean> => {
    outcome.calls.verifier += 1;
    const verdict = await deps.verify(candidate.email);
    const confidence = Math.max(candidate.confidence, verdict?.score ?? 0);
    outcome.steps.push(`email-verifier ${candidate.email} : ${verdict?.status ?? "sans réponse"} (${confidence})`);
    // c) « valid », ou « accept_all » avec une confiance ≥ 90.
    if (verdict && (verdict.status === "valid" || (verdict.status === "accept_all" && confidence >= MIN_ACCEPT_ALL_CONFIDENCE))) {
      outcome.contact = { ...candidate, confidence, verifier: verdict.status };
      return true;
    }
    return false;
  };

  const best = picks[0];
  if (best) {
    outcome.steps.push(`retenu : ${best.person.email} — ${best.person.position ?? "?"} (${best.target.label}, ${best.person.confidence})`);
    const found = await tryVerify({
      email: best.person.email.toLowerCase(),
      name: fullName(best.person.firstName, best.person.lastName),
      role: best.person.position?.trim() || best.target.label,
      roleKey: best.target.key,
      source: "hunter:domain-search",
      confidence: best.person.confidence ?? 0,
    });
    if (found) return outcome;
  }

  // b) Personne de sûr dans la recherche : Email Finder sur le dirigeant, s'il
  //    fait partie des rôles visés et que son adresse n'a pas déjà échoué.
  const leaderWanted = targets.some((target) => target.key === "dirigeant");
  const leaderTried = best ? isLeader(best.person, input.leader) : false;
  if (input.leader && leaderWanted && !leaderTried) {
    outcome.calls.finder += 1;
    const found = await deps.emailFinder(input.domain, input.leader.firstName, input.leader.lastName);
    outcome.steps.push(`email-finder ${input.leader.firstName} ${input.leader.lastName} @${input.domain} : ${found?.email ?? "rien"}`);
    if (found?.email && !blocked.has(found.email.toLowerCase())) {
      const ok = await tryVerify({
        email: found.email.toLowerCase(),
        name: `${input.leader.firstName} ${input.leader.lastName}`,
        role: found.position?.trim() || ROLES.dirigeant.label,
        roleKey: "dirigeant",
        source: "hunter:email-finder",
        confidence: found.score ?? 0,
      });
      if (ok) return outcome;
    }
  }
  // d) Rien de sûr : l'appelant garde l'adresse générique.
  outcome.steps.push("aucune adresse nominative sûre : l'adresse générique reste");
  return outcome;
}

/** « Contact : Prénom Nom — Poste (Hunter, confiance 94 %) ». */
export function contactLine(contact: { name: string | null; role: string | null; source: string | null; confidence: number | null }): string | null {
  if (!contact.name && !contact.role) return null;
  const who = [contact.name, contact.role].filter(Boolean).join(" — ");
  const via = contact.source?.startsWith("hunter") ? "Hunter" : contact.source ?? null;
  const meta = [via, contact.confidence ? `confiance ${contact.confidence} %` : null].filter(Boolean).join(", ");
  return meta ? `${who} (${meta})` : who;
}
