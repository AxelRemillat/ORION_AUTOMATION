import type { Prospect } from "@/types";

/**
 * Prompt d'analyse commerciale.
 *
 * Principe directeur : l'email ne doit contenir AUCUN chiffre que l'on ne
 * possede pas reellement sur le prospect. Une version precedente demandait au
 * modele d'estimer un volume, de le convertir en heures puis en euros ; ces
 * ordres de grandeur inventes arrivaient dans le corps du mail sous forme de
 * faits ("1 500 commandes/an", "10 500 EUR perdus"). C'est faux, et c'est le
 * genre de detail qu'un dirigeant repere immediatement.
 *
 * Le modele recoit donc les donnees reellement collectees (Pappers, annuaire
 * public, signaux web, Hunter), la liste explicite de ce qui MANQUE, et
 * l'interdiction de combler les trous. Le pain point devient une hypothese
 * assumee, ancree sur un fait verifiable.
 */

export const SYSTEM_PROMPT = `Tu es un freelance expert en automatisation et en IA appliquee aux PME francaises.
Tu prepares une prise de contact a froid.

REGLE ABSOLUE — HONNETETE FACTUELLE
- N'invente JAMAIS de chiffre. N'ecris un nombre que s'il figure LITTERALEMENT
  dans les DONNEES fournies (effectif, chiffre d'affaires, capital, annee de
  creation, resultat, date d'un signal).
- Sont formellement interdits : volumes d'activite estimes, heures perdues,
  euros economisables, pourcentages de gain, delais de retour sur
  investissement, tailles d'equipe deduites. Aucun calcul, aucune extrapolation.
- Si une information n'est pas dans les DONNEES, elle n'existe pas. Ne la
  devine pas, ne la presente pas comme probable.
- Ne presente JAMAIS une hypothese comme un fait. Le pain point est une
  hypothese : formule-la comme telle ("souvent", "en general", "je suppose
  que", une question ouverte), jamais comme un constat sur leur entreprise.

LE PAIN POINT
- Une phrase : le processus manuel probablement le plus couteux chez eux.
- Il doit etre JUSTIFIE par un fait reel present dans les DONNEES : un signal
  d'actualite, le secteur, l'effectif, une info du site. Sans fait exploitable,
  appuie-toi sur le secteur et la taille, et dis-le franchement.

REGLES DE L'EMAIL
- Francais, vouvoiement, ton direct et concret. AUCUNE formule creuse
  ("j'espere que vous allez bien", "je me permets de vous contacter",
  "acteur incontournable", "solution innovante").
- Moins de 120 mots, corps seul, sans signature ni longue formule finale.
- Structure : 1) une phrase d'ouverture sur un FAIT REEL les concernant, repris
  des DONNEES ; 2) l'hypothese de pain point, formulee comme une hypothese ;
  3) ce que tu proposes, en une phrase concrete ; 4) un CTA doux : un echange
  de 30 minutes.
- Pas de markdown, pas de crochets, aucun champ a completer.
- Mieux vaut un email court et sobre qu'un email precis et faux.

Reponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "pain_point": "une phrase, formulee comme une hypothese",
  "evidence": [
    { "label": "nature du fait", "value": "le fait, repris tel quel des DONNEES", "source": "d'ou il vient" }
  ],
  "email": { "subject": "objet court, sans majuscules inutiles", "body": "corps de l'email" }
}
"evidence" contient 1 a 4 faits REELS, recopies depuis les DONNEES, qui
justifient le pain point. Chaque entree cite sa provenance dans "source"
(ex : "Pappers", "Signal web", "Annuaire public", "Site de l'entreprise").
N'y mets jamais une estimation : si tu n'as qu'un secteur et un effectif,
"evidence" ne contient que ces deux faits.`;

/** Formate un montant en euros, sans inventer de precision. */
function euros(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Serialise le prospect en un contexte compact.
 *
 * On liste aussi explicitement ce qui MANQUE : un modele a qui l'on dit
 * « effectif inconnu » invente nettement moins qu'un modele face a un silence.
 */
export function buildContext(prospect: Prospect): string {
  const figures = prospect.key_figures ?? {};

  const known: string[] = [];
  const missing: string[] = [];

  const add = (label: string, value: string | null) => {
    if (value) known.push(`${label} : ${value}`);
    else missing.push(label.toLowerCase());
  };

  known.push(`Entreprise : ${prospect.company_name}`);
  add("Secteur", str(prospect.sector));
  add("Tranche d'effectif", str(prospect.size_range) ?? str(figures.size_range));
  add(
    "Effectif precis",
    num(figures.headcount) !== null ? `${num(figures.headcount)} salaries` : null,
  );
  add("Ville", str(prospect.city));
  add("Site web", str(prospect.website));
  add("SIREN", str(prospect.siren));
  add("Forme juridique", str(figures.legal_form));
  add("Code NAF", str(figures.naf_code));
  add(
    "Annee de creation",
    num(figures.founded_year) !== null ? String(num(figures.founded_year)) : null,
  );

  const revenue = num(figures.revenue_eur);
  const revenueYear = num(figures.revenue_year);
  add(
    "Chiffre d'affaires",
    revenue !== null ? `${euros(revenue)}${revenueYear ? ` (exercice ${revenueYear})` : ""}` : null,
  );
  add("Resultat net", num(figures.net_income_eur) !== null ? euros(figures.net_income_eur as number) : null);
  add("Capital social", num(figures.capital_eur) !== null ? euros(figures.capital_eur as number) : null);

  const leader = str(figures.leader);
  const leaderRole = str(figures.leader_role);
  add("Dirigeant", leader ? `${leader}${leaderRole ? ` (${leaderRole})` : ""}` : null);
  add("Contact connu", str(prospect.email));

  // Signaux : on conserve la date et la source, qui rendent le fait citable.
  const signals = (prospect.signals ?? []).slice(0, 6).map((signal, index) => {
    const parts = [str(signal.label) ?? "signal"];
    const excerpt = str(signal.excerpt);
    if (excerpt) parts.push(excerpt.slice(0, 200));
    const meta = [str(signal.date), str(signal.source)].filter(Boolean).join(", ");
    if (meta) parts.push(`[${meta}]`);
    return `${index + 1}. ${parts.join(" — ")}`;
  });

  const painPoint = str(prospect.pain_point);

  return [
    "DONNEES REELLES COLLECTEES SUR CE PROSPECT",
    "(sources : annuaire public des entreprises, Pappers, recherche web, Hunter)",
    "",
    known.join("\n"),
    painPoint ? `\nPain point deja note par l'utilisateur : ${painPoint}` : "",
    "",
    signals.length
      ? `SIGNAUX WEB REELS (${signals.length}) :\n${signals.join("\n")}`
      : "SIGNAUX WEB : aucun signal n'a ete trouve. N'en invente pas, et n'evoque aucune actualite les concernant.",
    "",
    missing.length
      ? `DONNEES INDISPONIBLES — ne les invente pas, n'y fais aucune allusion chiffree : ${missing.join(", ")}.`
      : "Toutes les donnees usuelles sont disponibles ci-dessus.",
  ]
    .filter((block) => block !== "")
    .join("\n");
}

/** Un fait reel retenu pour justifier le pain point, avec sa provenance. */
export interface Evidence {
  label: string;
  value: string;
  source: string;
}

export interface Analysis {
  pain_point: string;
  evidence: Evidence[];
  email: { subject: string; body: string };
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * Montants en euros presents dans un texte, normalises en nombres.
 * Sert de garde-fou : un montant qui n'est pas dans les donnees reelles est
 * signale a l'utilisateur avant envoi.
 */
export function extractEuroAmounts(text: string): number[] {
  const matches = text.matchAll(/(\d[\d\s., ]*)\s*(?:€|eur\b|euros\b)/gi);
  const amounts: number[] = [];
  for (const match of matches) {
    const raw = match[1].replace(/[\s. ]/g, "").replace(",", ".");
    const value = Number(raw);
    if (Number.isFinite(value)) amounts.push(Math.round(value));
  }
  return amounts;
}

/** Valide la reponse du modele ; renvoie null si elle est inexploitable. */
export function parseAnalysis(raw: string): Analysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const source = parsed as Record<string, unknown>;
  const email = (source.email ?? {}) as Record<string, unknown>;
  const body = asString(email.body);
  if (!body) return null;

  // Un fait sans provenance n'est pas un fait : on l'ecarte plutot que de le
  // presenter a l'utilisateur comme verifie.
  const evidence = Array.isArray(source.evidence)
    ? source.evidence
        .map((item) => item as Record<string, unknown>)
        .filter(
          (item) => asString(item.label) && asString(item.value) && asString(item.source),
        )
        .slice(0, 4)
        .map((item) => ({
          label: asString(item.label),
          value: asString(item.value),
          source: asString(item.source),
        }))
    : [];

  return {
    pain_point: asString(source.pain_point, "Hypothese non formulee."),
    evidence,
    email: { subject: asString(email.subject, "Une piste d'automatisation"), body },
  };
}
