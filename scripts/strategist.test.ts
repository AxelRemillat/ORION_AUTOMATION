/**
 * Tests du stratège, du rédacteur et de l'anti-homonymie — sans réseau.
 *
 * Tous les appels modèle sont des mocks : on vérifie ce que le CODE garantit
 * (schéma, fraîcheur, exclusion d'angle, cloisonnement des faits, rattachement
 * des signaux), pas ce qu'un modèle choisirait.
 *
 * Exécution : `npm run test:strategist`.
 */
import { buildFacts, type DerivedFact } from "../lib/emails/derived-facts";
import {
  briefFacts,
  runStrategist,
  targetingWarningFor,
  validateBrief,
  briefForDraft,
  type StrategistInput,
  type StrategyBrief,
} from "../lib/emails/strategist";
import { interpretJob } from "../lib/emails/job-roles";
import { validateEmail } from "../lib/emails/validate";
import {
  attachMention,
  attachSignals,
  displayCompanyName,
  isLargeGroup,
  mentionsExactDenomination,
} from "../lib/enrichment/entity-match";
import { isAnchored } from "../lib/enrichment/extract";
import { modelFor, reasoningEffortFor } from "../lib/ai/models";
import { buildParams } from "../lib/ai/params";
import { envModelPrices, openAiCost } from "../lib/usage/pricing";
import { SHORTEN_ROLE } from "../lib/emails/quality/generate";
import { buildStrategistPrompt, factsHash, hrBriefReason } from "../lib/emails/strategist";
import { autoRegenRefusal, isAgentSource, scriptJobSource } from "../lib/jobs/regen-cap";
import { buildWritingPrompt } from "../app/api/emails/generate/prompt";
import { draftFromBrief } from "../app/api/emails/generate/pipeline";
import type { AskFn } from "../lib/ai/chat";
import type { Prospect } from "../types";
import { defaultOffer } from "../lib/offer/read";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);

const prospect = (over: Partial<Prospect> = {}): Prospect => ({
  id: "p1", user_id: "u", company_name: "BLUE ENERFREEZE", siren: "844104851",
  website: "https://www.blue-enerfreeze.com", email: null,
  sector: "Production et distribution de vapeur et d'air conditionné", size_range: "20 à 49 salariés",
  city: "Lyon", source: "auto", signals: [], key_figures: { naf_code: "35.30Z", revenue_eur: 50_290_772 },
  pain_point: null, status: "nouveau", created_at: "", updated_at: "", ...over,
});

/** Blue EnerFreeze : un recrutement frais, un signal non daté, un groupe. */
const blue = prospect({
  signals: [
    {
      type: "recrutement", label: "Recrutement en cours",
      quote: "Blue EnerFreeze recrute un automaticien H/F en CDI pour ses installations frigorifiques",
      url: "https://www.blue-enerfreeze.com/carrieres", date: daysAgo(20), confidence: 0.9,
    },
    {
      type: "croissance", label: "Développement annoncé",
      quote: "Blue EnerFreeze s'implante sur un nouveau site logistique",
      url: "https://www.blue-enerfreeze.com/actus",
    },
  ],
  key_figures: {
    naf_code: "35.30Z", revenue_eur: 50_290_772, site_status: "lu",
    parent_group: "STEF", parent_group_quote: "Blue EnerFreeze, filiale du Groupe STEF",
    is_large_group_subsidiary: true,
  },
});
const blueFacts = buildFacts(blue, null, NOW);
const byLabel = (facts: DerivedFact[], pattern: RegExp) => facts.find((fact) => pattern.test(fact.value));
const freshHire = byLabel(blueFacts.facts, /automaticien/)!;
const undated = byLabel(blueFacts.facts, /nouveau site logistique/)!;
const revenue = blueFacts.facts.find((fact) => fact.key === "revenue")!;
const group = blueFacts.facts.find((fact) => fact.key === "parent_group")!;

const input = (over: Partial<StrategistInput> = {}): StrategistInput => ({
  facts: blueFacts.facts,
  companyName: blueFacts.companyName,
  isLargeGroupSubsidiary: blueFacts.isLargeGroupSubsidiary,
  parentGroup: "STEF",
  foreignEntities: [],
  history: [],
  ...over,
});

const rawBrief = (over: Record<string, unknown> = {}) => ({
  rankedFacts: [
    { id: freshHire.id, reason: "recrutement récent sur un métier d'automatisme" },
    { id: group.id, reason: "filiale du groupe" },
  ],
  angle: {
    type: "recrutement",
    hookFactIds: [freshHire.id],
    insight: "Un automaticien de plus, c'est un parc supervisé qui s'étend et des alarmes à traiter plus vite.",
  },
  pain: {
    task: "tri des alarmes de supervision et ordres d'intervention",
    whyThem: [freshHire.id],
    automationIdea: "relier les alarmes de supervision à la création des ordres d'intervention dans la GMAO",
  },
  proofId: "p2",
  cta: "Comment sont triées les alarmes aujourd'hui ?",
  avoid: ["parler du chiffre d'affaires"],
  targetingWarning: "valeur inventée par le modèle",
  ...over,
});

(async () => {
  // -------------------------------------------------------------------------
  console.log("\n1. Validation zod du brief");
  // -------------------------------------------------------------------------
  {
    const ok = validateBrief(rawBrief(), input());
    check("un brief conforme passe", Boolean(ok.brief), ok.error);
    check("le nom vient du code, pas du modèle", ok.brief?.companyName === blueFacts.companyName);
    check(
      "l'avertissement de ciblage est imposé par le code",
      ok.brief?.targetingWarning === "Filiale de grand groupe (STEF), décision probablement au groupe.",
      ok.brief?.targetingWarning ?? "null",
    );

    const missing = validateBrief({ ...rawBrief(), angle: undefined }, input());
    check("angle manquant : rejet", !missing.brief && /angle/.test(missing.error ?? ""), missing.error);

    const badType = validateBrief(rawBrief({ angle: { ...rawBrief().angle, type: "compliment" } }), input());
    check("type d'angle hors liste : rejet", !badType.brief);

    const tooMany = validateBrief(
      rawBrief({ rankedFacts: Array.from({ length: 6 }, (_, index) => ({ id: `f${index + 1}`, reason: "raison" })) }),
      input(),
    );
    check("plus de 5 faits classés : rejet", !tooMany.brief);

    const ghost = validateBrief(rawBrief({ pain: { ...rawBrief().pain, whyThem: ["f99"] } }), input());
    check("factId inexistant : rejet", !ghost.brief && /f99/.test(ghost.error ?? ""), ghost.error);

    const privateProof = validateBrief(rawBrief({ proofId: "p42" }), input());
    check("preuve non publique : rejet", !privateProof.brief && /proofId/.test(privateProof.error ?? ""));

    const nullProof = validateBrief(rawBrief({ proofId: null }), input());
    check("preuve nulle acceptée", Boolean(nullProof.brief));

    const generic = validateBrief(rawBrief({ pain: { ...rawBrief().pain, task: "gestion administrative" } }), input());
    check("pain générique : rejet", !generic.brief);

    check(
      "sans groupe, pas d'avertissement",
      targetingWarningFor({ isLargeGroupSubsidiary: false, parentGroup: null }) === null,
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n2. Signal non daté ou périmé : interdit comme angle principal");
  // -------------------------------------------------------------------------
  {
    check("le fait non daté est marqué non frais", undated.date === null && undated.fresh === false);
    check("le recrutement récent est frais", freshHire.fresh === true);

    const undatedHook = validateBrief(
      rawBrief({ angle: { type: "signal", hookFactIds: [undated.id], insight: "Un nouveau site logistique change les flux de froid." } }),
      input(),
    );
    check("angle sur signal non daté : rejet", !undatedHook.brief && /non daté|périmé/.test(undatedHook.error ?? ""), undatedHook.error);

    const old = prospect({
      signals: [
        {
          type: "recrutement", label: "Recrutement", url: "https://www.blue-enerfreeze.com/c",
          quote: "Blue EnerFreeze recrute un planificateur", date: daysAgo(120),
        },
      ],
    });
    const oldFacts = buildFacts(old, null, NOW);
    const stale = oldFacts.facts.find((fact) => fact.key === "signal")!;
    const staleHook = validateBrief(
      {
        ...rawBrief(),
        rankedFacts: [{ id: stale.id, reason: "recrutement" }],
        angle: { type: "recrutement", hookFactIds: [stale.id], insight: "Un planificateur de plus, un planning recalculé plus souvent." },
        pain: { ...rawBrief().pain, whyThem: [stale.id] },
      },
      input({ facts: oldFacts.facts }),
    );
    check("angle sur signal de 120 jours : rejet", !staleHook.brief);

    const typeWithoutSignal = validateBrief(
      rawBrief({ angle: { type: "recrutement", hookFactIds: [group.id], insight: "Le groupe recrute beaucoup en ce moment, visiblement." } }),
      input(),
    );
    check("type recrutement sans signal frais : rejet", !typeWithoutSignal.brief);

    const groupAngle = validateBrief(
      rawBrief({ angle: { type: "groupe", hookFactIds: [group.id], insight: "Filiale d'un groupe du froid : les process viennent souvent d'en haut." } }),
      input(),
    );
    check("sans signal, un angle groupe reste permis", Boolean(groupAngle.brief), groupAngle.error);

    // Le modèle s'entête : deux réponses non datées → pas de brief.
    const asked: string[] = [];
    const stubborn = await runStrategist(async (_system, user) => {
      asked.push(user);
      return JSON.stringify(
        rawBrief({ angle: { type: "signal", hookFactIds: [undated.id], insight: "Un nouveau site logistique change les flux de froid." } }),
      );
    }, input());
    check("deux angles non datés : aucun brief", stubborn.brief === null);
    check("une seule reprise", asked.length === 2, String(asked.length));
    check("la reprise reçoit l'erreur exacte", /REJETEE.*(non daté|périmé)/s.test(asked[1] ?? ""));
  }

  // -------------------------------------------------------------------------
  console.log("\n3. « Autre angle » : l'angle précédent est exclu");
  // -------------------------------------------------------------------------
  {
    const previous = validateBrief(rawBrief(), input()).brief!;
    const exclusion = input({ excludeAngles: [previous.angle] });

    const same = validateBrief(rawBrief(), exclusion);
    check("même angle : rejet", !same.brief && /déjà refusé/.test(same.error ?? ""), same.error);

    const prompts: { system: string; user: string }[] = [];
    const replies = [
      rawBrief(),
      rawBrief({ angle: { type: "groupe", hookFactIds: [group.id], insight: "Filiale d'un groupe du froid : les process viennent souvent d'en haut." } }),
    ];
    const outcome = await runStrategist(async (system, user) => {
      prompts.push({ system, user });
      return JSON.stringify(replies[prompts.length - 1]);
    }, exclusion);
    check("le prompt liste l'angle exclu", prompts[0].user.includes("ANGLES DEJA PROPOSES ET REFUSES") && prompts[0].user.includes(previous.angle.insight));
    check("la reprise produit un autre angle", outcome.brief?.angle.type === "groupe", outcome.error);
    check("l'angle exclu est mémorisé dans le brief", outcome.brief?.excludedAngles.length === 1);

    // Aucun appel réseau : seul le mock `ask` est sollicité.
    let networkCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error("réseau interdit");
    }) as typeof fetch;
    const mockAsk: AskFn = async (role) => {
      if (role === "strategist") return JSON.stringify(replies[1]);
      if (role === "writer") {
        return JSON.stringify({ email: { subject: "alarmes et interventions", body: "Bonjour,\n\nA\n\nB\n\nC ?\n\nAxel" } });
      }
      return "{}";
    };
    const again = await runStrategist((system, user, operation) => mockAsk("strategist", system, user, 0, operation), exclusion);
    await draftFromBrief({
      offer: defaultOffer(),
      ask: mockAsk, brief: again.brief!, facts: blueFacts.facts, tone: "direct", contact: null,
      prospectId: "p1", registryName: "BLUE ENERFREEZE", avoid: [], judge: false,
    });
    globalThis.fetch = realFetch;
    check("stratège + rédacteur : zéro appel réseau (Linkup, Pappers, Hunter)", networkCalls === 0, String(networkCalls));
  }

  // -------------------------------------------------------------------------
  console.log("\n4. Le rédacteur ne voit que les faits du brief");
  // -------------------------------------------------------------------------
  {
    const brief = validateBrief(rawBrief(), input()).brief as StrategyBrief;
    const allowed = briefFacts(brief, blueFacts.facts).map((fact) => fact.id);
    check("faits du brief = accroche ∪ pain ∪ classés", allowed.includes(freshHire.id) && allowed.includes(group.id));
    check("le CA n'est pas dans le brief", !allowed.includes(revenue.id));

    const prompt = buildWritingPrompt({
      offer: defaultOffer(),
      tone: "direct", brief, facts: blueFacts.facts, contact: null, prospectId: "p1", avoid: [],
    });
    check("la valeur du CA est absente du prompt", !prompt.includes("50 290 772") && !prompt.includes(revenue.value));
    check("le fait non référencé est absent", !prompt.includes("nouveau site logistique"));
    check("le fait d'accroche est présent", prompt.includes("automaticien"));
    // Les preuves viennent desormais de /offre, choisies par recoupement de
    // tags avec le pain — plus de `persona.proofs` en dur.
    check("l'identité vient de /offre", prompt.includes("Axel Remillat"));
    check("le titre de /offre est transmis", prompt.includes("Automatisation & IA pour PME"));
    check("l'offre d'entrée est transmise", prompt.includes("une démo de 15 min"));
    check("la promesse est transmise", prompt.includes("sans changer d'outil"));
    check(
      "aucune preuve hors sujet n'est imposée",
      prompt.includes("aucune demo ne correspond a CE pain") || prompt.includes("PREUVE A MOBILISER"),
    );
    check("le nom exact est imposé", prompt.includes(`« ${brief.companyName} »`));

    // ARTFLEX : négoce + pain de commande → agent devis, métier cité explicitement.
    const negoceBrief = { ...brief, pain: { ...brief.pain, task: "confirmer les commandes des installateurs", automationIdea: "préparer la confirmation de commande" } };
    const negocePrompt = buildWritingPrompt({
      offer: defaultOffer(),
      tone: "direct", brief: negoceBrief, facts: blueFacts.facts, contact: null, prospectId: "p1", avoid: [],
      sector: "Commerce de gros de fournitures pour la plomberie et le chauffage",
    });
    // BOUVET CARTIER : syndic + gestion locative + transaction → le syndic, pas la liste.
    check("plusieurs activités : le rédacteur en nomme une seule", /PLUSIEURS ACTIVITES : nomme UNE seule/.test(negocePrompt) && /syndic/.test(negocePrompt));
    check("négoce : le métier de l'agent est imposé au rédacteur", /exemple de LEUR metier \(négoce B2B\)/.test(negocePrompt), negocePrompt.match(/PREUVE[^\n]*\n[^\n]*/)?.[0] ?? "");

    const numbers = validateEmail(
      { subject: "alarmes et interventions", body: "Bonjour,\n\nAvec 50 M€ de CA, vous traitez beaucoup d'alarmes.\n\nJe relie les alarmes aux ordres.\n\nC'est un sujet ?\n\nAxel" },
      { facts: briefFacts(brief, blueFacts.facts), tone: "direct", companyName: "BLUE ENERFREEZE" },
    );
    check("un chiffre hors brief est refusé par le validateur", numbers.failures.some((line) => /Nombre absent/.test(line)));
  }

  // -------------------------------------------------------------------------
  console.log("\n5. Anti-homonymie : le cas Jacquet");
  // -------------------------------------------------------------------------
  {
    const target = { name: "JACQUET PARIS", siren: "123456789", website: null };
    const homonym = {
      text: "Jacquet Metal Service recrute un technicien méthodes / ordonnancement (CDI)",
      url: "https://www.jacquetmetalservice.com/carrieres",
    };
    const verdict = attachMention(homonym, target);
    check(
      "« Jacquet Metal Service » n'est pas JACQUET PARIS",
      verdict.kind === "rejected" && verdict.reason === "homonyme probable",
      JSON.stringify(verdict),
    );
    check("l'entité voisine est nommée", verdict.kind === "rejected" && "entity" in verdict && verdict.entity === "Jacquet Metal Service");

    check("dénomination exacte : rattaché", attachMention({ text: "Jacquet Paris recrute un vendeur", url: "https://presse.fr/x" }, target).kind === "prospect");
    check("SIREN cité : rattaché", attachMention({ text: "SIREN 123 456 789, nouvelle boutique", url: "https://x.fr" }, target).kind === "prospect");
    check("domaine vérifié : rattaché", attachMention({ text: "Nous recrutons", url: "https://shop.jacquet.paris/jobs" }, { ...target, website: "https://jacquet.paris" }).kind === "prospect");
    check("nom proche : jamais exact", !mentionsExactDenomination("Jacquet Metal Service recrute", "JACQUET"));
    check("forme juridique ignorée", mentionsExactDenomination("Jacquet Paris ouvre une boutique", "JACQUET PARIS SAS"));

    // Lien capitalistique prouvé au registre : c'est un signal de groupe.
    const linked = attachSignals(
      [{ type: "recrutement", label: "Recrutement", quote: homonym.text, url: homonym.url, date: daysAgo(10) }],
      target,
      { parentCompany: "JACQUET METAL SERVICE" },
    );
    check("lien prouvé : traité comme groupe parent", linked.kept[0]?.scope === "groupe" && linked.rejected.length === 0);
    const citedGroup = attachSignals(
      [{ type: "recrutement", label: "Recrutement", quote: homonym.text, url: homonym.url }],
      target,
      { parentGroup: "Jacquet Metal Service", parentGroupQuote: "Jacquet Paris, filiale de Jacquet Metal Service" },
    );
    check("groupe parent cité : traité comme groupe", citedGroup.kept[0]?.scope === "groupe");
    const uncited = attachSignals(
      [{ type: "recrutement", label: "Recrutement", quote: homonym.text, url: homonym.url }],
      target,
      { parentGroup: "Jacquet Metal Service" },
    );
    check("groupe sans citation : pas une preuve", uncited.rejected[0]?.reason === "homonyme probable");
    check("grand groupe au-delà de 250 salariés", isLargeGroup({ headcount: 900 }));
    check("grand groupe au-delà de 50 M€", isLargeGroup({ revenueEur: 214_600_000 }));
    check("PME : pas un grand groupe", !isLargeGroup({ headcount: 40, revenueEur: 8_000_000 }));

    // De bout en bout : les faits du prospect, puis le mail.
    const jacquet = prospect({
      company_name: "JACQUET PARIS", siren: "123456789", website: null, city: "Paris",
      key_figures: { naf_code: "47.71Z" },
      signals: [{ type: "recrutement", label: "Recrutement en cours", quote: homonym.text, url: homonym.url, date: daysAgo(10), confidence: 0.8 }],
    });
    const facts = buildFacts(jacquet, null, NOW);
    check("aucun recrutement attribué à JACQUET PARIS", !facts.facts.some((fact) => fact.key === "signal"));
    check("raison « homonyme probable » conservée", facts.rejectedSignals[0]?.reason === "homonyme probable");
    check("l'homonyme rejoint la liste interdite", facts.foreignEntities.includes("Jacquet Metal Service"));
    check("nom du mail = dénomination du registre en casse naturelle", facts.companyName === "Jacquet Paris", facts.companyName);

    const withLink = buildFacts({ ...jacquet, key_figures: { ...jacquet.key_figures, parent_company: "JACQUET METAL SERVICE" } }, null, NOW);
    check("avec lien : fait de groupe, jamais un recrutement du prospect", withLink.facts.some((fact) => fact.key === "group_signal") && !withLink.facts.some((fact) => fact.key === "signal"));

    const leaked = validateEmail(
      { subject: "méthodes et ordonnancement", body: "Bonjour,\n\nJacquet Metal Service recrute.\n\nJe relie les flux.\n\nC'est un sujet ?\n\nAxel" },
      { facts: facts.facts, tone: "direct", companyName: "JACQUET PARIS", forbiddenNames: facts.foreignEntities },
    );
    check("le validateur bloque le nom de l'homonyme", leaked.failures.some((line) => /homonyme/.test(line)), leaked.failures.join(" | "));

    check(
      "extraction : le document de l'homonyme n'est pas ancré",
      !isAnchored({ url: homonym.url, title: "Jacquet Metal Service — Paris", content: homonym.text }, { name: "JACQUET PARIS", city: "Paris" }),
    );
    check(
      "extraction : le SIREN suffit à ancrer",
      isAnchored({ url: "https://presse.fr/a", title: "Boutique", content: "SIREN 123456789 : ouverture" }, { name: "JACQUET PARIS", siren: "123456789" }),
    );

    check("enseigne confirmée reprise telle quelle", displayCompanyName("BLUE ENERFREEZE", ["Blue EnerFreeze recrute"]) === "Blue EnerFreeze");
    // Vu dans un mail reel : « L Arbre A Souhaits ». Le tokeniseur ignore
    // l'apostrophe, la casse naturelle doit la rendre.
    check(
      "apostrophe conservée",
      displayCompanyName("L'ARBRE A SOUHAITS") === "L'Arbre A Souhaits",
      displayCompanyName("L'ARBRE A SOUHAITS"),
    );
    check(
      "trait d'union conservé",
      displayCompanyName("SAINT-JEAN LOGISTIQUE") === "Saint-Jean Logistique",
      displayCompanyName("SAINT-JEAN LOGISTIQUE"),
    );
  }

  // -------------------------------------------------------------------------
  console.log("\n6. Lecture des postes");
  // -------------------------------------------------------------------------
  {
    const role = interpretJob("recrute un automaticien H/F");
    check("automaticien reconnu", role?.key === "automaticien");
    check("automaticien = automates et supervision", /automates/.test(role?.does ?? "") && /supervision/.test(role?.does ?? ""));
    check("jamais « tâches répétitives »", !/repetitiv|répétitiv/.test(`${role?.does} ${role?.consequence}`));
    check("ADV reconnu", interpretJob("Assistante ADV en CDI")?.key === "adv");
    check("ordonnancement reconnu", interpretJob("technicien ordonnancement")?.key === "planification");
    check("la lecture du poste accompagne le fait", Boolean(freshHire.reading?.includes("automates")));
  }

  // -------------------------------------------------------------------------
  console.log("\n7. Modèles configurables");
  // -------------------------------------------------------------------------
  {
    check("défaut = modèle historique", modelFor("strategist", {}) === "gpt-4o-mini");
    check("OPENAI_MODEL reste le repli", modelFor("writer", { OPENAI_MODEL: "gpt-4.1-mini" }) === "gpt-4.1-mini");
    check("variable de rôle prioritaire", modelFor("judge", { OPENAI_MODEL: "a", OPENAI_MODEL_JUDGE: "b" }) === "b");

    // Les capacites sont desormais decidees par `buildParams` (lib/ai/params).
    const classic = buildParams({ model: "gpt-4.1-mini", temperature: 0.85 });
    check("modèle classique : température conservée", classic.temperature === 0.85);
    const reasoning = buildParams({ model: "o3-mini", temperature: 0.2, reasoningEffort: "medium" });
    check("modèle de raisonnement : pas de température", !("temperature" in reasoning));
    check("effort de raisonnement transmis", reasoning.reasoning_effort === "medium");
    check(
      "effort réglable par variable",
      reasoningEffortFor("strategist", { OPENAI_REASONING_EFFORT_STRATEGIST: "high" }) === "high",
    );

    const prices = envModelPrices('{"modele-x":{"input":1,"output":4},"casse":{"input":"x"}}');
    check("prix fournis par OPENAI_PRICES_JSON", prices["modele-x"]?.outputPerMillion === 4 && !prices.casse);
    check("modèle hors grille : prix marqué inconnu", openAiCost("modele-inconnu", 1000, 1000).priceKnown === false);

    // Cowork #54 : tokens servis par le cache de prompt, au prix « cached_input » s'il est fourni.
    const cachedPrices = envModelPrices('{"modele-c":{"input":2,"output":10,"cached_input":0.2},"modele-n":{"input":2,"output":10}}');
    check("cached_input lu dans OPENAI_PRICES_JSON", cachedPrices["modele-c"]?.cachedInputPerMillion === 0.2 && cachedPrices["modele-n"]?.cachedInputPerMillion === undefined);
    const before = process.env.OPENAI_PRICES_JSON;
    process.env.OPENAI_PRICES_JSON = '{"modele-c":{"input":2,"output":10,"cached_input":0.2},"modele-n":{"input":2,"output":10}}';
    const full = openAiCost("modele-c", 1_000_000, 0).cost;
    const half = openAiCost("modele-c", 1_000_000, 0, 500_000).cost;
    check("moitié de l'entrée en cache : coût = 0,5 × 2 $ + 0,5 × 0,2 $", Math.abs(half / full - 1.1 / 2) < 1e-6, `${half} / ${full}`);
    check("sans prix cached_input : aucune remise supposée", openAiCost("modele-n", 1_000_000, 0, 500_000).cost === openAiCost("modele-n", 1_000_000, 0).cost);
    check("cache borné aux tokens d'entrée", openAiCost("modele-c", 100, 0, 999).cost === openAiCost("modele-c", 100, 0, 100).cost);
    if (before === undefined) delete process.env.OPENAI_PRICES_JSON; else process.env.OPENAI_PRICES_JSON = before;
    check("raccourcissement d'un mail : modèle du juge (léger), pas celui du rédacteur", SHORTEN_ROLE === "judge");

    // Cowork #54 : règles du stratège identiques d'une fiche à l'autre (cache de prompt) ; nom et homonymes dans le message.
    const one = buildStrategistPrompt(input({ companyName: "ALPHA SAS" }));
    const two = buildStrategistPrompt(input({ companyName: "BETA SARL", foreignEntities: ["Beta Holding"] }));
    check("système du stratège identique pour deux fiches (servi par le cache)", one.system === two.system && !one.system.includes("ALPHA SAS"));
    check("nom et homonymes dans le message utilisateur", two.user.startsWith("Entreprise : BETA SARL") && two.user.includes("« Beta Holding »") && !one.user.includes("Homonymes"));
  }

  console.log("\nRégénération sans stratège (Cowork #37)");
  {
    let calls = 0;
    const strategist = async () => {
      calls += 1;
      return validateBrief(rawBrief(), input());
    };
    const stored = validateBrief(rawBrief(), input()).brief;
    const reused = await briefForDraft({ mode: "full", storedBrief: stored, strategist: input() }, strategist);
    check("brief stocké valide : régénération SANS rappeler le stratège", calls === 0 && Boolean(reused.brief) && reused.reused === true);
    await briefForDraft({ mode: "full", storedBrief: null, strategist: input() }, strategist);
    check("première rédaction (brief vide) : le stratège tourne une fois", calls === 1);
    await briefForDraft({ mode: "full", storedBrief: { angle: "abîmé" }, strategist: input() }, strategist);
    check("brief stocké refusé par la validation : le stratège tourne", calls === 2);
    await briefForDraft({ mode: "other_angle", storedBrief: stored, strategist: input() }, strategist);
    check("« autre angle » : le stratège tourne (il doit changer d'angle)", calls === 3);
  }

  console.log("\nRégénérations plafonnées, brief repris tant que les faits ne changent pas (Cowork #56)");
  {
    let calls = 0;
    const strategist = async () => {
      calls += 1;
      return validateBrief(rawBrief(), input());
    };
    const stored = validateBrief(rawBrief(), input()).brief!;
    const hash = factsHash(input().facts);
    check("empreinte des faits stable et sensible au contenu", hash === factsHash([...input().facts].reverse()) && hash !== factsHash(input().facts.slice(1)));
    const same = await briefForDraft({ mode: "full", storedBrief: { ...stored, factsHash: hash }, strategist: input() }, strategist);
    check("mêmes faits : brief repris, stratège non relancé", calls === 0 && same.reused === true);
    await briefForDraft({ mode: "full", storedBrief: { ...stored, factsHash: "deadbeef" }, strategist: input() }, strategist);
    check("faits changés : le stratège tourne une fois", calls === 1);
    await briefForDraft({ mode: "full", storedBrief: stored, strategist: input() }, strategist);
    check("brief d'avant (sans empreinte) : repris comme avant", calls === 1);

    const NOW = new Date("2026-10-14T08:00:00Z");
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    check("aucune génération : la première rédaction automatique passe", autoRegenRefusal([], NOW) === null);
    check("rédaction initiale seule : une régénération automatique passe", autoRegenRefusal([{ createdAt: at(1), auto: true }], NOW) === null);
    const refused = autoRegenRefusal([{ createdAt: at(3), auto: true }, { createdAt: at(1), auto: true }], NOW);
    check("déjà une régénération automatique sur 7 jours : refusée, motif lisible", Boolean(refused && /au plus 1 par 7 jours/.test(refused) && /à la main/.test(refused)), String(refused));
    check("régénération automatique de plus de 7 jours : une nouvelle passe", autoRegenRefusal([{ createdAt: at(20), auto: true }, { createdAt: at(9), auto: true }], NOW) === null);
    check("régénérations MANUELLES : jamais comptées", autoRegenRefusal([{ createdAt: at(3), auto: true }, { createdAt: at(2), auto: false }, { createdAt: at(1), auto: false }], NOW) === null);
    check("source d'agent reconnue (mesure, hors plafond)", isAgentSource("agent2") && !isAgentSource("prod") && !isAgentSource(null));
    // Cowork #57 (SKI SHOP) : brief RH tiré d'une offre d'emploi → écarté avant la rédaction.
    const job = { id: "f3", label: "Signal web", value: "Renfort service paie (H/F) (17 septembre 2026)" };
    const shop = { angle: { type: "recrutement", hookFactIds: ["f3", "f2"], insight: "Les dossiers du personnel arrivent de quarante magasins." }, pain: { task: "Réunir les pièces des dossiers salariés, repérer celles qui manquent et préremplir les documents d’entrée.", whyThem: [], automationIdea: "" } } as never;
    check("SKI SHOP : angle RH tiré d'une offre d'emploi → écarté, motif lisible", /Angle écarté avant la rédaction/.test(hrBriefReason(shop, [job]) ?? ""));
    const hint = { angle: { type: "recrutement", hookFactIds: ["f3"], insight: "Une assistante devis recrutée : les devis débordent." }, pain: { task: "Préparer les devis de menuiserie à partir des demandes reçues.", whyThem: [], automationIdea: "" } } as never;
    check("offre d'emploi qui sert d'INDICE d'un pain métier (devis) : rédigeable", hrBriefReason(hint, [{ id: "f3", label: "Signal web", value: "Assistante devis (H/F)" }]) === null);
    const payroll = { angle: { type: "métier", hookFactIds: ["f1"], insight: "Cabinet comptable." }, pain: { task: "Réunir les variables de paie de leurs clients.", whyThem: [], automationIdea: "" } } as never;
    check("paie d'un cabinet comptable, angle métier : rédigeable", hrBriefReason(payroll, [{ id: "f1", label: "Activité", value: "Expertise comptable" }]) === null);
    check("script d'agent : job étiqueté source agent2", scriptJobSource({ USAGE_SOURCE: "agent2" }).source === "agent2" && !("source" in scriptJobSource({ USAGE_SOURCE: "prod" })) && !("source" in scriptJobSource({})));
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
