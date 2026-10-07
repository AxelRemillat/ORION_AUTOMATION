import { DEMO_HOST } from "@/lib/emails/quality/demo-links";
import { countedText, wordCount } from "@/lib/mail-preflight/words";

/**
 * FAMILLE F5 « PARTENAIRE » — le mail du segment Agences.
 *
 * Les familles F1 à F4 écrivent à une entreprise qui a un problème. F5 écrit à
 * un intermédiaire qui a des CLIENTS et pas la main-d'œuvre : le problème n'est
 * pas le sien, il est à ses clients, et la proposition ne doit pas le concurrencer
 * mais le renforcer. D'où une grille propre.
 *
 * Les six critères viennent de Cowork (06/10/2026). Chacun porte :
 *   - une `instruction`, destinée au prompt de rédaction ;
 *   - un `check` DÉTERMINISTE quand la conformité est mesurable sur le texte.
 *
 * Pourquoi des vérifications déterministes alors que le moteur de check-list
 * d'agent2 (#32) fera autorité : elles tournent déjà, sans appel LLM et sans
 * attendre son merge. Quand #32 arrive, `F5_CRITERIA` lui est passé tel quel —
 * c'est exactement sa forme d'entrée — et les `check` restent utiles comme
 * garde-fous gratuits avant de payer un juge.
 */

/** Plafond de mots du corps, hors signature. Cowork : 75 mots. */
export const F5_MAX_WORDS = 75;
/** Sous ce nombre, le mail est trop maigre pour dire quoi que ce soit. */
export const F5_MIN_WORDS = 40;

/** Ce que la vérification lit : le mail produit, et ce qui a servi à l'écrire. */
export interface F5Mail {
  subject: string;
  /** Corps tel qu'il est stocké, signature et mention « stop » comprises. */
  body: string;
  /**
   * Signature posée par le code. Fournie, elle est RETIRÉE avant toute
   * vérification : elle contient un lien du domaine de démo et une vingtaine
   * de mots qui ne sont pas de l'argumentaire.
   */
  signature?: string | null;
  /** Faits employés, avec leur URL. Un fait sans URL n'est pas sourcé. */
  facts: readonly { label: string; url?: string | null }[];
}

export interface F5Check {
  ok: boolean;
  /** Ce qui a été constaté, en clair : sert au rapport et à la correction. */
  detail: string;
}

export interface F5Criterion {
  id: string;
  /**
   * Critère SÉMANTIQUE délégué à la check-list commune (lib/emails/quality).
   * Sa consigne d'écriture reste ici ; son verdict vient de C1/C2, qui lisent
   * vraiment la phrase au lieu d'y chercher des mots.
   */
  judgedBy?: "checklist";
  label: string;
  /** Consigne de rédaction, injectée dans le prompt. */
  instruction: string;
  /** Vérification gratuite. Absente = le jugement revient au moteur d'agent2. */
  check?: (mail: F5Mail) => F5Check;
}



/** La marque blanche, dite explicitement : c'est l'offre, pas un sous-entendu. */
const WHITE_LABEL =
  /\b(?:marque blanche|sous votre nom|[àa] votre nom|en votre nom|sans appara[îi]tre|votre sous-traitant|pour votre compte)\b/i;

/** Première personne : « je » fait la proposition, pas « nous » ni une tournure passive. */
const FIRST_PERSON = /\bj(?:e|'|’)\s*\w|\bje\b|\bmoi\b|\bmon\b|\bma\b|\bmes\b/i;

/**
 * Questions du corps : l'appel à l'action doit être unique.
 *
 * Les URL sont retirées AVANT de compter : « ?demo=email&v=5 » contient un
 * point d'interrogation, et sans cette précaution le mail cible lui-même
 * échouait au critère « un seul appel à l'action ».
 */
const questions = (body: string) =>
  (stripUrls(body).match(/\?/g) ?? []).length;

/**
 * Le CORPS ARGUMENTATIF : sans la signature ni la mention « stop ».
 *
 * `countedText` est le comptage unique de l'application (lib/mail-preflight) :
 * l'éditeur, le validateur de génération et le contrôle avant envoi l'emploient
 * déjà. La grille F5 s'y aligne plutôt que de recompter à sa façon.
 */
const argument = (mail: F5Mail): string => countedText(mail.body, mail.signature ?? null);

/** Retire les URL, nues ou protocolées. */
const stripUrls = (text: string) =>
  text.replace(/https?:\/\/\S+/g, " ").replace(/\b[\w.-]+\.[a-z]{2,}\/\S*/gi, " ");

const FIFTEEN_MIN = /\b(?:15|quinze)\s*(?:min|minutes)\b/i;

export const F5_CRITERIA: readonly F5Criterion[] = [
  {
    id: "fait-source",
    label: "Un fait sourcé, propre à CETTE agence",
    judgedBy: "checklist",
    instruction:
      "Ouvre sur un fait précis lu sur LEUR site : un client nommé, une réalisation, un outil, une offre qui n'est qu'à eux. TEST DE SUBSTITUTION : si la phrase reste vraie pour dix autres agences du même métier, elle ne vaut rien — « vous créez des sites pour les artisans et commerçants » décrit une activité, pas cette agence. Jamais un compliment.",
    // Jugé par C1 : seule une lecture peut dire si la phrase est substituable.
    check: (mail) => {
      const sourced = mail.facts.filter((fact) => typeof fact.url === "string" && fact.url.length > 8);
      return sourced.length > 0
        ? { ok: true, detail: `${sourced.length} fait(s) avec URL — spécificité jugée par C1` }
        : { ok: false, detail: "aucun fait porteur d'une URL vérifiable" };
    },
  },
  {
    id: "probleme-client",
    label: "Le problème : demandes de leurs clients, ou capacité limitée",
    judgedBy: "checklist",
    instruction:
      "Nomme le problème côté AGENCE, et nomme L'ÉLÉMENT QUI MANQUE puis SA CONSÉQUENCE — pas « une demande sans contenu défini peut retarder le devis », mais « sans budget ni périmètre, votre équipe relance deux fois avant de chiffrer ». Ce sont des demandes d'automatisation ou d'IA de leurs clients qu'ils ne savent pas produire, ou une capacité qui les oblige à refuser. Pas de problème inventé : si le site ne le laisse pas voir, dis-le comme une question.",
  },
  {
    id: "marque-blanche",
    label: "Proposition marque blanche, à la première personne",
    instruction:
      "Propose de réaliser en marque blanche, à la première personne : « je construis », « je livre sous votre nom ». L'agence garde la relation client et la facturation.",
    check: (mail) => {
      const core = argument(mail);
      const white = WHITE_LABEL.test(core);
      const first = FIRST_PERSON.test(core);
      if (white && first) return { ok: true, detail: "marque blanche explicite, à la 1re personne" };
      if (!white) return { ok: false, detail: "la marque blanche n'est pas dite explicitement" };
      return { ok: false, detail: "proposition pas à la première personne" };
    },
  },
  {
    id: "preuve",
    label: "Une preuve : démo du portfolio ou ORION",
    instruction:
      "Donne un lien de démo testable en une minute, ou cite ORION comme preuve de ce que tu construis seul. Un lien, pas trois.",
    check: (mail) => {
      const core = argument(mail);
      const links = (core.match(new RegExp(DEMO_HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
      const orion = /\bORION\b/.test(core);
      if (links === 1) return { ok: true, detail: "une démo liée" };
      if (links === 0 && orion) return { ok: true, detail: "ORION cité comme preuve" };
      if (links === 0) return { ok: false, detail: "aucune preuve : ni démo ni ORION" };
      return { ok: false, detail: `${links} liens de démo : il en faut un seul` };
    },
  },
  {
    id: "un-seul-cta",
    label: "Un seul appel à l'action",
    instruction:
      "Termine par UNE question, et une seule : un créneau de 15 minutes cette semaine. Aucune autre question dans le mail.",
    check: (mail) => {
      const core = argument(mail);
      const count = questions(core);
      if (count === 0) return { ok: false, detail: "aucune demande" };
      if (count > 1) return { ok: false, detail: `${count} questions : une seule est permise` };
      return FIFTEEN_MIN.test(core)
        ? { ok: true, detail: "une question, 15 minutes" }
        : { ok: false, detail: "la demande ne propose pas de créneau de 15 minutes" };
    },
  },
  {
    id: "longueur",
    label: `${F5_MAX_WORDS} mots au plus`,
    instruction: `Le corps tient en ${F5_MAX_WORDS} mots au maximum, signature exclue. En dessous de ${F5_MIN_WORDS}, il ne dit rien.`,
    check: (mail) => {
      const words = wordCount(argument(mail));
      if (words > F5_MAX_WORDS) return { ok: false, detail: `${words} mots (max ${F5_MAX_WORDS})` };
      if (words < F5_MIN_WORDS) return { ok: false, detail: `${words} mots seulement (min ${F5_MIN_WORDS})` };
      return { ok: true, detail: `${words} mots` };
    },
  },
];

export interface F5Verdict {
  /** Tous les critères vérifiables sont au vert. */
  ready: boolean;
  passed: { id: string; detail: string }[];
  failed: { id: string; label: string; detail: string }[];
  /** Critères dont le verdict vient de la check-list commune (C1, C2). */
  delegated: { id: string; detail: string }[];
  /** Critères laissés au moteur d'agent2 : non vérifiables sans jugement. */
  deferred: string[];
}

/** Applique la grille F5. Gratuit, déterministe, sans appel réseau. */
export function checkF5(mail: F5Mail): F5Verdict {
  const passed: F5Verdict["passed"] = [];
  const failed: F5Verdict["failed"] = [];
  const deferred: string[] = [];
  const delegated: F5Verdict["delegated"] = [];

  for (const criterion of F5_CRITERIA) {
    if (!criterion.check) {
      if (criterion.judgedBy === "checklist") delegated.push({ id: criterion.id, detail: "jugé par la check-list commune" });
      else deferred.push(criterion.id);
      continue;
    }
    const verdict = criterion.check(mail);
    if (criterion.judgedBy === "checklist") {
      // Le verdict appartient à C1/C2. Ici on ne retient que l'empêchement
      // matériel (pas un seul fait sourcé : il n'y a rien à citer).
      if (!verdict.ok) failed.push({ id: criterion.id, label: criterion.label, detail: verdict.detail });
      else delegated.push({ id: criterion.id, detail: verdict.detail });
      continue;
    }
    if (verdict.ok) passed.push({ id: criterion.id, detail: verdict.detail });
    else failed.push({ id: criterion.id, label: criterion.label, detail: verdict.detail });
  }

  // `ready` ne dit plus que le DÉTERMINISTE. La lecture — C1, C2 — vient de
  // judgeChecklist ; `delegated` nomme ce qui reste à lui demander.
  return { ready: failed.length === 0, passed, failed, deferred, delegated };
}

/** Bloc de consignes F5, à concaténer au prompt de rédaction. */
export function f5Instructions(): string {
  return [
    "FAMILLE F5 — PARTENAIRE (agence web ou marketing).",
    "Tu écris à un intermédiaire : il vend à ses clients, tu réalises sans apparaître.",
    "",
    ...F5_CRITERIA.map((criterion, index) => `${index + 1}. ${criterion.label} — ${criterion.instruction}`),
  ].join("\n");
}
