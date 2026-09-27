/**
 * Tests du gating, de la datation et des accroches de situation.
 *
 * Chaque bloc fige un cas réellement observé en production : TERDICI VEGETAL
 * sans accroche, une ouverture sur la structure juridique, un dirigeant entrant
 * qu'on n'adressait pas, une offre récente dont on ne faisait rien.
 *
 * Exécution : `npm run test:accroche`.
 */
import { GENERIC_DRAFT_LABEL, canOpenMail, hookReadiness } from "../lib/emails/hook-readiness";
import {
  capitalIncreased,
  freshJobHook,
  incomingLeader,
  incomingLeaderAngle,
  leadsTheCompany,
  isRecentAppointment,
  leaderEmailQuery,
  readIncomingLeader,
} from "../lib/emails/incoming-leader";
import {
  bodaccEstablishmentDate,
  dateUndatedSignals,
  isHookFresh,
  pappersEstablishmentDate,
  publishedDateIn,
  secondaryEstablishmentDate,
} from "../lib/signals/dating";
import { buildFacts } from "../lib/emails/derived-facts";
import { attachSignals, nearbyEntity } from "../lib/enrichment/entity-match";
import { isCommercialPosition } from "../lib/enrichment/hunter";
import { chooseRecipient, painIsCommercial } from "../lib/jobs/handlers/email";
import { officialQuote } from "../lib/signals";
import { chooseProof, signatureFor } from "../lib/offer/model";
import { defaultOffer } from "../lib/offer/read";
import {
  contradictsAvoid,
  opensOnSiteMention,
  opensOnStructure,
  paraphrasesSite,
  undatedEventHook,
  validateEmail,
  wordCount,
} from "../lib/emails/validate";
import type { Prospect, ProspectSignal } from "../types";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const offer = defaultOffer();
const NOW = new Date("2026-09-26");

const prospect = (over: Partial<Prospect> = {}): Prospect => ({
  id: "p", user_id: "u", company_name: "X", siren: "123456789", website: null, email: null,
  sector: "Commerce de gros", size_range: "20 à 49 salariés", city: "Torcé", source: "auto",
  signals: [], key_figures: {}, pain_point: null, status: "nouveau", created_at: "", updated_at: "",
  ...over,
});

async function main(): Promise<void> {
  console.log("\n1. Gating : TERDICI VEGETAL n'a pas d'accroche");
  {
    // Le cas réel : ni signal daté, ni contenu de site. Uniquement du registre.
    const terdici = buildFacts(
      prospect({
        company_name: "TERDICI VEGETAL",
        key_figures: { naf_code: "46.21Z", headcount: 35, revenue_eur: 23_177_510, revenue_year: 2017 },
      }),
      null,
      NOW,
    ).facts;
    const verdict = hookReadiness(terdici);
    check("TERDICI est bloqué", !verdict.ready, verdict.reason);
    check("la raison est actionnable", verdict.reason.includes("À nourrir"), verdict.reason);
    check("aucun fait ne peut ouvrir", verdict.strong.length === 0);

    // Un signal daté et frais débloque.
    const avecSignal = buildFacts(
      prospect({
        company_name: "TERDICI VEGETAL",
        key_figures: { naf_code: "46.21Z", headcount: 35 },
        signals: [
          {
            type: "recrutement",
            label: "Poste ouvert : Assistant ADV — exemple.fr",
            url: "https://exemple.fr/offre",
            source: "exemple.fr",
            // L'ancrage exige que la citation NOMME l'entreprise : sans cela le
            // signal est ecarte comme « non rattache », et c'est voulu.
            quote: "Terdici Vegetal recrute un assistant ADV pour son service commandes.",
            confidence: 0.9,
            date: "2026-09-20",
          },
        ],
      }),
      null,
      NOW,
    ).facts;
    const debloque = hookReadiness(avecSignal);
    check("un signal daté débloque", debloque.ready, debloque.reason);
    check("le signal est retenu comme accroche", debloque.strong.some((f) => f.key === "signal"));

    // Un signal NON daté ne débloque pas : il ne prouve rien du présent.
    const nonDate = buildFacts(
      prospect({
        signals: [
          {
            type: "croissance",
            label: "Ouverture d'un site — presse.fr",
            url: "https://presse.fr/a",
            source: "presse.fr",
            quote: "X ouvre une nouvelle agence cette annee, indique la direction.",
            confidence: 0.8,
          },
        ],
      }),
      null,
      NOW,
    ).facts;
    check("un signal non daté ne débloque pas", !hookReadiness(nonDate).ready);
    check(
      "et la raison le dit",
      hookReadiness(nonDate).reason.includes("pas de date"),
      hookReadiness(nonDate).reason,
    );
  }

  console.log("\n2. Les faits de ciblage n'ouvrent jamais un mail");
  {
    const facts = buildFacts(
      prospect({ key_figures: { naf_code: "46.21Z", headcount: 35, parent_company: "J.DIS", revenue_eur: 1_000_000 } }),
      null,
      NOW,
    ).facts;
    for (const key of ["naf", "headcount", "size_range", "revenue", "age", "parent_group"]) {
      const fact = facts.find((item) => item.key === key);
      if (fact) check(`« ${key} » ne peut pas ouvrir`, !canOpenMail(fact));
    }
    check("le label générique existe", GENERIC_DRAFT_LABEL === "générique");
  }

  console.log("\n3. Accroche interdite : la structure juridique");
  {
    const facts = buildFacts(prospect(), null, NOW).facts;
    const signature = signatureFor(offer);
    const mail = (accroche: string) =>
      validateEmail(
        {
          subject: "commandes et livraisons",
          body:
            `Bonjour,\n\n${accroche}\n\nJe suis Axel Remillat, je construis des flux.\n\n` +
            `Comptez 2 à 3 semaines.\n\nEst-ce que ça vous parlerait ?\n\n${signature}`,
        },
        { facts, contact: null, tone: "direct", companyName: "X", signature, offerNumbers: [2, 3] },
      ).failures.join(" | ");

    check("« représentée par » refusé", mail("Terdici est représentée par J.DIS.").includes("structure juridique"));
    check("« filiale de » refusé", mail("Vous êtes filiale de STEF.").includes("structure juridique"));
    check("« appartient au groupe » refusé", mail("Votre société appartient au groupe X.").includes("structure juridique"));
    check("« société mère » refusé", mail("Votre société mère pilote les achats.").includes("structure juridique"));
    check(
      "un fait d'actualité passe",
      !mail("Vous avez ouvert une agence à Lavelanet au printemps.").includes("structure juridique"),
    );
    check(
      "la mention hors accroche est tolérée",
      opensOnStructure(
        `Bonjour,\n\nVous avez ouvert une agence.\n\nVotre société mère pilote les achats.\n\nOk ?\n\n${signature}`,
        signature,
      ) === null,
    );
  }

  console.log("\n4. Longueur : cible 100, plafond 120 STRICT");
  {
    const facts = buildFacts(prospect(), null, NOW).facts;
    const signature = signatureFor(offer);
    const corps = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`).join(" ");
    const mail = (n: number) =>
      validateEmail(
        {
          subject: "commandes et livraisons",
          body: `Bonjour,\n\nVous préparez des commandes.\n\nJe suis Axel Remillat.\n\n${corps(n)}\n\nOk ?\n\n${signature}`,
        },
        { facts, contact: null, tone: "direct", companyName: "X", signature },
      ).failures.filter((f) => f.includes("mots")).join(" | ");

    check("un mail dans la cible passe", mail(95) === "", mail(95));
    // Le plafond est passe de 125 a 120, strict : c'est le bloc offre qui paie
    // la difference (budget 35 mots au lieu de 40).
    check("au-delà de 120, échec", mail(130).includes("120"), mail(130));
    check("la signature reste hors comptage", wordCount(signature) > 5);
  }

  console.log("\n5. Datation d'un signal fort non daté");
  {
    check(
      "article:published_time lu",
      publishedDateIn('<meta property="article:published_time" content="2026-03-14T09:00:00+01:00">') === "2026-03-14",
    );
    check(
      "attributs inversés lus aussi",
      publishedDateIn('<meta content="2026-03-14" property="article:published_time">') === "2026-03-14",
    );
    check(
      "JSON-LD datePublished lu",
      publishedDateIn(
        '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-04-02"}</script>',
      ) === "2026-04-02",
    );
    check(
      "@graph lu aussi",
      publishedDateIn(
        '<script type="application/ld+json">{"@graph":[{"@type":"Article","datePublished":"2026-05-11"}]}</script>',
      ) === "2026-05-11",
    );
    check("<time datetime> en dernier recours", publishedDateIn('<time datetime="2026-01-09">') === "2026-01-09");
    check("une date future est refusée", publishedDateIn('<time datetime="2099-01-01">') === null);
    check("une page sans date rend null", publishedDateIn("<html><body>rien</body></html>") === null);

    check("moins de 12 mois → accroche autorisée", isHookFresh("2026-03-01", NOW));
    check("plus de 12 mois → refusée", !isHookFresh("2024-03-01", NOW));
    check("sans date → refusée", !isHookFresh(null, NOW));

    // BODACC : seules les CRÉATIONS comptent. Vérifié en réel sur SELECTION
    // HABITAT — 30 annonces, toutes des dépôts de comptes, donc aucune date.
    const bodacc = await bodaccEstablishmentDate("453450256", {
      fetchImpl: async () =>
        new Response(JSON.stringify({ results: [{ dateparution: "2026-02-10", ville: "Lavelanet" }] }), { status: 200 }),
    });
    check("une création BODACC est datée", bodacc === "2026-02-10", String(bodacc));
    check(
      "un BODACC vide rend null",
      (await bodaccEstablishmentDate("1", { fetchImpl: async () => new Response('{"results":[]}', { status: 200 }) })) === null,
    );

    // Établissement secondaire : on ignore le siège et on prend le plus récent.
    const etab = await secondaryEstablishmentDate("1", {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                matching_etablissements: [
                  { date_creation: "2016-01-01", libelle_commune: "RODEZ", est_siege: true },
                  { date_creation: "2026-02-20", libelle_commune: "LAVELANET" },
                  { date_creation: "2021-05-26", libelle_commune: "MIREPOIX" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    });
    check("le plus récent hors siège", etab === "2026-02-20", String(etab));

    const cible = await secondaryEstablishmentDate("1", {
      city: "Mirepoix",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                matching_etablissements: [
                  { date_creation: "2026-02-20", libelle_commune: "LAVELANET" },
                  { date_creation: "2021-05-26", libelle_commune: "MIREPOIX" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    });
    check("la ville visée est préférée", cible === "2021-05-26", String(cible));
  }

  console.log("\n6. Dirigeant entrant : on lui écrit, à lui");
  {
    const leader = readIncomingLeader({
      incoming_leader: "MARIE CLAIRE DEVESA",
      incoming_leader_role: "Présidente",
      incoming_leader_since: "2026-06-15",
    });
    check("le dirigeant est lu", leader !== null);
    check("prénom usuel seul", leader?.firstName === "Marie", String(leader?.firstName));
    check("nom en casse naturelle", leader?.lastName === "Devesa", String(leader?.lastName));
    check("nom complet sans 2e prénom", leader?.fullName === "Marie Devesa", String(leader?.fullName));
    check("nomination récente", isRecentAppointment(leader?.since ?? null, NOW));
    check("une nomination de 2023 ne l'est plus", !isRecentAppointment("2023-01-01", NOW));
    check("un seul mot n'est pas un dirigeant", readIncomingLeader({ incoming_leader: "DEVESA" }) === null);
    check("rien du tout rend null", readIncomingLeader({}) === null);

    const angle = incomingLeaderAngle(leader!, "DEVESA");
    check("l'angle nomme la personne", angle.includes("Marie Devesa"));
    check("l'angle porte les premiers mois", angle.includes("premiers mois"));
    check("l'angle nomme la remise à plat", angle.includes("remet à plat"));

    const query = leaderEmailQuery(leader!, "https://www.devesa.fr");
    check("requête Hunter sur prénom + nom + domaine", query?.domain === "devesa.fr" && query.firstName === "Marie");
    check("sans site, aucune requête", leaderEmailQuery(leader!, null) === null);
    check("un site illisible ne casse rien", leaderEmailQuery(leader!, "pas une url") === null);
  }

  console.log("\n7. Offre France Travail de moins de 30 jours");
  {
    const signal = (title: string, date: string): ProspectSignal => ({
      type: "recrutement",
      label: `Poste ouvert : ${title} — candidat.francetravail.fr, ${date}`,
      jobTitle: title,
      date,
      source: "candidat.francetravail.fr",
      confidence: 0.9,
    });

    const adv = freshJobHook(signal("Assistant ADV", "2026-09-10"), NOW);
    check("un assistant ADV est relié aux commandes", adv?.task.includes("commandes") === true, String(adv?.task));
    check("l'intitulé est conservé", adv?.title === "Assistant ADV");

    const compta = freshJobHook(signal("Comptable fournisseurs", "2026-09-05"), NOW);
    check("un comptable est relié aux factures", compta?.task.includes("factures") === true, String(compta?.task));

    check("une offre de plus de 30 jours est écartée", freshJobHook(signal("Assistant ADV", "2026-07-01"), NOW) === null);
    check("une offre non datée est écartée", freshJobHook({ label: "Poste ouvert : Assistant ADV — x" }, NOW) === null);
    check(
      "un poste hors catalogue n'invente aucun lien",
      freshJobHook(signal("Chauffeur poids lourd", "2026-09-20"), NOW) === null,
    );
  }

  console.log("\n8. Capital : « augmentation » seulement si Pappers le confirme");
  {
    check("précédent inférieur → augmentation", capitalIncreased(200_000, 50_000));
    check("aucun précédent → pas d'augmentation", !capitalIncreased(200_000, null));
    check("précédent égal → pas d'augmentation", !capitalIncreased(200_000, 200_000));
    check("précédent supérieur → pas d'augmentation", !capitalIncreased(50_000, 200_000));
    check("précédent à zéro → pas d'augmentation", !capitalIncreased(200_000, 0));
  }

  console.log("\n9. Preuve : commandes avant les démos de documents");
  {
    const commandes = chooseProof(offer, "saisir les références et quantités d'une commande client");
    check("commandes → agent-devis", commandes.proof?.id === "agent-devis", String(commandes.proof?.id));
    const devis = chooseProof(offer, "produire un devis à partir d'une demande client");
    check("devis → agent-devis", devis.proof?.id === "agent-devis", String(devis.proof?.id));

    const emails = chooseProof(offer, "trier les e-mails entrants du service client");
    check("e-mails → démo n8n nommée", emails.sentence?.includes("le tri d'e-mails") === true, String(emails.sentence));
    const factures = chooseProof(offer, "rapprocher les factures fournisseurs");
    check("factures → démo nommée", factures.sentence?.includes("factures") === true, String(factures.sentence));
    const sav = chooseProof(offer, "traiter les réclamations et le SAV");
    check("SAV → démo nommée", sav.sentence?.includes("le SAV") === true, String(sav.sentence));
    const cr = chooseProof(offer, "rédiger les comptes rendus de visite");
    check("comptes rendus → démo nommée", cr.sentence?.includes("comptes rendus") === true, String(cr.sentence));
  }


  console.log("\n10. Ouverture d'etablissement : l'accroche qu'on jetait");
  {
    // Le cas réel : SELECTION HABITAT a ouvert Périgueux et Montmoreau le
    // 01/03/2026. Pappers le dit, l'annuaire public non — et sans cette
    // lecture la fiche n'avait aucune accroche datée.
    const facts = buildFacts(
      prospect({
        company_name: "SELECTION HABITAT",
        key_figures: {
          naf_code: "68.31Z",
          headcount: 120,
          recent_openings: [
            { city: "Périgueux", date: "2026-03-01" },
            { city: "Montmoreau", date: "2026-03-01" },
          ],
        },
      }),
      null,
      NOW,
    );

    const opening = facts.facts.find((fact) => fact.key === "opening");
    check("l'ouverture devient un fait", Boolean(opening), JSON.stringify(facts.facts.map((f) => f.key)));
    check("elle peut ouvrir le mail", opening ? canOpenMail(opening) : false);
    check("rang 1 : elle prime sur le métier", opening?.hookTier === 1, String(opening?.hookTier));
    check("les deux villes sont citées", /Périgueux.+Montmoreau/.test(opening?.value ?? ""), opening?.value);
    check("la fiche est prête", hookReadiness(facts.facts).ready);

    // Lavelanet date de 2022 : vrai, vérifiable, et sans intérêt.
    const old = buildFacts(
      prospect({ key_figures: { naf_code: "68.31Z", recent_openings: [{ city: "Lavelanet", date: "2022-02-01" }] } }),
      null,
      NOW,
    );
    check("une ouverture de 2022 n'est pas une nouvelle", !old.facts.some((fact) => fact.key === "opening"));
    check("et la fiche reste à nourrir", !hookReadiness(old.facts).ready);
  }

  console.log("\n11. Dirigeant entrant : lu depuis les vraies clés");
  {
    const fromSignal = readIncomingLeader({
      new_leader_name: "Bernard NARBONNET",
      new_leader_role: "gérant",
      signal_date: "2026-08-12",
    });
    check("le dirigeant de l'annonce est lu", fromSignal?.fullName === "Bernard Narbonnet", String(fromSignal?.fullName));
    check("la date du signal fait la nomination", fromSignal?.since === "2026-08-12", String(fromSignal?.since));

    const fromPappers = readIncomingLeader({ leader_person: "MARIE DEVESA", leader_since: "2026-05-02" });
    check("Pappers fait aussi foi", fromPappers?.since === "2026-05-02", String(fromPappers?.since));

    // Un dirigeant en poste depuis 2016 n'est pas un dirigeant entrant.
    const installed = { leader_person: "JEAN VILAIN", leader_since: "2016-12-19" };
    check("dix ans en poste : aucune arrivée", incomingLeader(installed, NOW) === null);
    check("mais le dirigeant est bien lu", readIncomingLeader(installed)?.fullName === "Jean Vilain");

    const facts = buildFacts(
      prospect({
        company_name: "DEVESA",
        key_figures: { naf_code: "43.22A", leader_person: "MARIE DEVESA", leader_since: "2026-05-02" },
      }),
      null,
      NOW,
    );
    const arrival = facts.facts.find((fact) => fact.key === "new_leader");
    check("l'arrivée devient un fait de rang 1", arrival?.hookTier === 1, String(arrival?.hookTier));
    check("elle ouvre le mail", arrival ? canOpenMail(arrival) : false);
    check("la valeur brute ne part pas telle quelle", arrival?.bodyUsable === false);
    check("la fiche est prête", hookReadiness(facts.facts).ready);
  }

  console.log("\n12. Datation de rattrapage sur les signaux sans date");
  {
    const page =
      '<html><head><meta property="article:published_time" content="2026-07-04T09:00:00+02:00"></head></html>';
    const fakeFetch = (async (url: string) => ({
      ok: true,
      text: async () => (String(url).includes("ladepeche") ? page : ""),
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const signals: ProspectSignal[] = [
      { label: "Ouverture d'une agence", url: "https://www.ladepeche.fr/article", quote: "X ouvre une agence." },
      { label: "Actualité du groupe", url: "https://exemple.fr/a", scope: "groupe" } as ProspectSignal,
    ];

    const dated = await dateUndatedSignals(signals, { siren: "453450256", fetchImpl: fakeFetch });
    check("le signal sans date est daté", dated.signals[0].date === "2026-07-04", String(dated.signals[0].date));
    check("l'appelant sait qu'il doit écrire en base", dated.changed);
    check("un signal du groupe n'est pas daté", dated.signals[1].date === undefined);

    // Déjà daté : aucun aller-retour, donc rien ne bouge.
    const already = await dateUndatedSignals([{ label: "a", url: "https://x.fr", date: "2026-09-01" }], {
      siren: "453450256",
      fetchImpl: fakeFetch,
    });
    check("rien à faire quand la date est là", !already.changed);
  }

  console.log("\n13. Pappers date les établissements");
  {
    const body = {
      etablissements: [
        { ville: "RODEZ", date_de_creation: "2016-01-01", siege: true },
        { ville: "LAVELANET", date_de_creation: "2022-02-01", siege: false },
        { ville: "PERIGUEUX", date_de_creation: "2026-03-01", siege: false },
        { ville: "AUCH", date_de_creation: "2026-04-01", siege: false, etablissement_cesse: true },
      ],
    };
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => body,
      text: async () => "",
    })) as unknown as typeof fetch;

    // Sans clé, la source est sautée : le test en pose une factice, l'appel
    // étant de toute façon simulé.
    process.env.PAPPERS_API_KEY = process.env.PAPPERS_API_KEY || "test";
    const latest = await pappersEstablishmentDate("453450256", { fetchImpl: fakeFetch });
    check("la plus récente ouverture gagne", latest === "2026-03-01", String(latest));
    check("le siège ne compte pas", latest !== "2016-01-01");
    check("un établissement fermé ne compte pas", latest !== "2026-04-01");

    const city = await pappersEstablishmentDate("453450256", { fetchImpl: fakeFetch, city: "Lavelanet" });
    check("la ville visée est préférée", city === "2022-02-01", String(city));
  }


  console.log("\n14. Un administrateur n'est pas un dirigeant entrant");
  {
    // ELYCOOP (69), le 26/09/2026 : « Besma HATHROUBI devient administrateur ».
    // Ouvrir sur « vous avez pris la direction de… » aurait été faux.
    const board = {
      new_leader_name: "Besma HATHROUBI",
      new_leader_role: "administrateur",
      signal_date: "2026-09-25",
    };
    check("l'administrateur est lu", readIncomingLeader(board)?.fullName === "Besma Hathroubi");
    check("mais il n'ouvre pas le mail", incomingLeader(board, NOW) === null);
    check("un administrateur ne dirige pas", !leadsTheCompany("administrateur"));
    check("un gérant, oui", leadsTheCompany("gérant"));
    check("une présidente, oui", leadsTheCompany("Présidente"));
    check("un directeur général, oui", leadsTheCompany("directeur général"));
    check("une fonction inconnue passe", leadsTheCompany(null));

    const facts = buildFacts(
      prospect({ company_name: "ELYCOOP", key_figures: { naf_code: "70.22Z", ...board } }),
      null,
      NOW,
    );
    check("aucun fait « nouveau dirigeant »", !facts.facts.some((fact) => fact.key === "new_leader"));
  }

  console.log("\n15. Une annonce officielle garde son rattachement");
  {
    // BODACC publie POUR un SIREN : sa citation est le libellé du greffe, qui ne
    // nomme pas l'entreprise. La règle d'ancrage écrite pour le web écartait
    // donc tous les signaux officiels — vu sur SUN'R GROUPE et L'ARBRE A
    // SOUHAITS le 26/09/2026.
    const official: ProspectSignal = {
      type: "direction",
      label: "Marion DUTEL devient gérant (25 septembre 2026)",
      url: "https://www.bodacc.fr/annonce/1",
      date: "2026-09-25",
      source: "BODACC",
      dateBasis: "source",
      quote: "Modification de l'administration.",
      strength: "fort",
    };
    const attached = attachSignals([official], { name: "L'ARBRE A SOUHAITS", siren: "941551806", website: null });
    check("le signal officiel est gardé", attached.kept.length === 1, JSON.stringify(attached.rejected));

    // Un signal web garde, lui, l'exigence de citation nominative.
    const web: ProspectSignal = {
      label: "Une entreprise recrute",
      url: "https://exemple.fr/a",
      quote: "Une société du secteur recrute un assistant.",
      source: "Linkup",
    };
    check("un signal web sans nom reste écarté", attachSignals([web], { name: "L'ARBRE A SOUHAITS", siren: "941551806", website: null }).kept.length === 0);
  }

  console.log("\n16. Mouvement de capital : jamais une accroche");
  {
    // SUN'R GROUPE (69) : « Modification du capital », sans sens connu. BODACC
    // ne dit ni hausse ni baisse et ne publie pas le capital précédent.
    const signal: ProspectSignal = {
      type: "croissance",
      label: "Modification du capital (25 septembre 2026)",
      url: "https://www.bodacc.fr/annonce/2",
      date: "2026-09-25",
      source: "BODACC",
      dateBasis: "source",
      quote: "Modification du capital.",
      strength: "fort",
    };
    const facts = buildFacts(
      prospect({ company_name: "SUN'R GROUPE", signals: [signal], key_figures: { naf_code: "35.11Z" } }),
      null,
      NOW,
    );
    const move = facts.facts.find((fact) => fact.key === "capital_move");
    check("le fait existe, comme contexte", Boolean(move));
    check("mais il n'ouvre pas le mail", move ? !canOpenMail(move) : false);
    check("et la valeur ne part pas telle quelle", move?.bodyUsable === false);
    check("la fiche est donc à nourrir", !hookReadiness(facts.facts).ready);

    // Hausse confirmée : Pappers porte encore un capital inférieur à l'annonce.
    const confirmed = buildFacts(
      prospect({
        company_name: "SUN'R GROUPE",
        signals: [signal],
        key_figures: { naf_code: "35.11Z", capital_after_eur: 500_000, capital_eur: 100_000 },
      }),
      null,
      NOW,
    );
    check(
      "confirmée, elle redevient un signal",
      confirmed.facts.some((fact) => fact.key === "signal" && fact.fresh === true),
    );
  }

  console.log("\n17. La tuyauterie juridique ne sort pas du greffe");
  {
    // SIAM (75) : la citation retenue portait l'adresse de l'ancien
    // propriétaire, un numéro de dossier et le délai d'opposition.
    const nature =
      "Cession d'un fonds de commerce. Adresse de l'ancien propriétaire : 28 avenue Matignon 75008 " +
      "Paris Date de l'acte : 21/07/26 Enregistré le : 24/07/26 à Paris Saint-Lazare Dossier 2026 " +
      "00018436 Référence 7564P61 2026 A 02186 Les oppositions seront reçues";
    const quote = officialQuote({ nature, label: "Reprise d'un fonds de commerce" } as never);
    check("l'événement est conservé", /Cession d'un fonds de commerce/.test(quote), quote);
    check("l'adresse du tiers disparaît", !/Matignon/.test(quote), quote);
    check("le numéro de dossier disparaît", !/00018436/.test(quote), quote);
    check("le délai d'opposition disparaît", !/oppositions/.test(quote), quote);

    // Rien d'exploitable : on retombe sur le libellé normalisé.
    const bare = officialQuote({ nature: "Les oppositions seront reçues", label: "Reprise d'un fonds" } as never);
    check("repli sur le libellé", bare === "Reprise d'un fonds", bare);
  }


  console.log("\n18. Le « à ne pas dire » du brief est vérifié");
  {
    const avoid = [
      "Ne pas présenter l'inauguration de la nouvelle agence comme déjà faite : la date n'est pas connue.",
    ];
    const signature = "Axel Remillat\nAutomatisation & IA en production pour PME";

    // Le cas réel : le mail affirme ce que le brief vient d'interdire.
    const guilty =
      "Bonjour,\n\nVous venez d'inaugurer votre nouvelle agence : les dossiers circulent " +
      "maintenant entre deux sites.\n\nJe suis Axel Remillat.\n\nOn en parle ?\n\n" + signature;
    const breach = contradictsAvoid(guilty, avoid, { signature });
    check("l'affirmation interdite est vue", Boolean(breach), JSON.stringify(breach));
    check("la consigne fautive est nommée", breach?.line === avoid[0]);

    // Posé en hypothèse, c'est la bonne façon d'en parler.
    const hedged =
      "Bonjour,\n\nSi l'inauguration de votre nouvelle agence approche, les dossiers vont " +
      "circuler entre deux sites.\n\nJe suis Axel Remillat.\n\nOn en parle ?\n\n" + signature;
    check("l'hypothèse ne contredit rien", contradictsAvoid(hedged, avoid, { signature }) === null);

    // Un fait autorisé rend le propos légitime : le registre l'atteste.
    const facts = buildFacts(
      prospect({ key_figures: { naf_code: "68.31Z", recent_openings: [{ city: "Périgueux", date: "2026-03-01" }] } }),
      null,
      NOW,
    ).facts;
    const dated =
      "Bonjour,\n\nVous avez ouvert une agence à Périgueux en mars : les dossiers circulent " +
      "maintenant entre deux sites.\n\nJe suis Axel Remillat.\n\nOn en parle ?\n\n" + signature;
    check(
      "un fait daté et attesté passe",
      contradictsAvoid(dated, ["Ne pas parler de l'ouverture de Périgueux sans la dater."], {
        facts,
        signature,
      }) === null,
    );
    check("aucune consigne, aucun refus", contradictsAvoid(guilty, [], { signature }) === null);
  }

  console.log("\n19. Accroches interdites : le site cité, l'événement non daté");
  {
    const signature = "Axel Remillat\nAutomatisation & IA en production pour PME";
    const mail = (first: string) =>
      `Bonjour,\n\n${first}\n\nJe suis Axel Remillat.\n\nUn flux lirait vos dossiers.\n\nOn en parle ?\n\n${signature}`;

    check(
      "« sur votre site » est refusé",
      opensOnSiteMention(mail("Sur votre site, on lit que vous couvrez huit départements."), signature),
    );
    check(
      "« d'après votre site » aussi",
      opensOnSiteMention(mail("D'après votre site, vos agences travaillent en réseau."), signature),
    );
    check(
      "« votre site indique » aussi",
      opensOnSiteMention(mail("Votre site indique une présence sur huit départements."), signature),
    );
    check(
      "un fait dit sans citer la source passe",
      !opensOnSiteMention(mail("Vous couvrez huit départements depuis Rodez."), signature),
    );

    check(
      "« votre agence a ouvert » sans date est refusé",
      undatedEventHook(mail("Votre nouvelle agence a ouvert, et les dossiers circulent entre deux sites."), signature),
    );
    check(
      "la même phrase datée passe",
      !undatedEventHook(mail("Votre nouvelle agence a ouvert en mars, et les dossiers circulent entre deux sites."), signature),
    );
    check(
      "une année suffit à dater",
      !undatedEventHook(mail("Vos agences ont ouvert en 2026, les dossiers circulent entre deux sites."), signature),
    );
    check(
      "une phrase sans événement n'est pas concernée",
      !undatedEventHook(mail("Vos agences travaillent avec les mêmes dossiers papier."), signature),
    );
  }

  console.log("\n20. Paraphrase du site : refusée, implication acceptée");
  {
    const signature = "Axel Remillat\nAutomatisation & IA en production pour PME";
    const facts = buildFacts(
      prospect({
        key_figures: {
          naf_code: "68.31Z",
          site_offer: "Vente de biens immobiliers de caractère, estimation de biens et accompagnement personnalisé.",
          site_status: "lu",
        },
      }),
      null,
      NOW,
    ).facts;

    const copy =
      "Bonjour,\n\nVous vendez des biens immobiliers de caractère, avec estimation de biens et " +
      "accompagnement personnalisé.\n\nJe suis Axel Remillat.\n\nUn flux lirait vos dossiers.\n\nOn en parle ?\n\n" +
      signature;
    check("la quasi-copie est refusée", paraphrasesSite(copy, facts, signature));

    const implication =
      "Bonjour,\n\nUne estimation tient rarement dans un seul échange : les pièces arrivent " +
      "par bouts, et quelqu'un les rassemble.\n\nJe suis Axel Remillat.\n\nUn flux lirait vos dossiers.\n\nOn en parle ?\n\n" +
      signature;
    check("l'implication passe", !paraphrasesSite(implication, facts, signature));
    check("sans fait de site, rien à comparer", !paraphrasesSite(copy, [], signature));
  }

  console.log("\n21. Intérim, RH, formation : une preuve de dossiers");
  {
    // ARVE INTERIM : « devis » et « commande » ne veulent rien dire ici, et
    // proposer l'agent devis à une agence d'intérim tombe à côté.
    const interim = chooseProof(offer, "préparer les contrats de mission et relancer les pièces manquantes", {
      sector: "Activités des agences de travail temporaire",
    });
    check("intérim → démo n8n", interim.proof?.id === "n8n", String(interim.proof?.id));
    check("jamais l'agent devis", interim.proof?.id !== "agent-devis");

    // Même quand le pain parle de commandes : le métier décide.
    const tricky = chooseProof(offer, "suivre les commandes de personnel et les devis clients", {
      sector: "Activités des agences de travail temporaire",
    });
    check("le métier prime sur le mot « commande »", tricky.proof?.id === "n8n", String(tricky.proof?.id));

    const rh = chooseProof(offer, "constituer les dossiers du personnel", { sector: "Conseil en ressources humaines" });
    check("RH → démo n8n", rh.proof?.id === "n8n", String(rh.proof?.id));

    const formation = chooseProof(offer, "préparer les conventions de stage", { sector: "Formation continue d'adultes" });
    check("formation → démo n8n", formation.proof?.id === "n8n", String(formation.proof?.id));

    // Hors de ces métiers, l'agent devis reste le bon choix.
    const negoce = chooseProof(offer, "saisir les références d'une commande client", {
      sector: "Commerce de gros de matériaux",
    });
    check("un négoce garde l'agent devis", negoce.proof?.id === "agent-devis", String(negoce.proof?.id));
  }


  console.log("\n22. MAISONS TERRE D'OC : un fait de site n'ouvre plus un mail");
  {
    // La fiche réelle : aucun signal daté, et un « fait de site » qui venait en
    // vérité de l'extrait du registre (site_status valait « non trouvé »).
    const facts = buildFacts(
      prospect({
        company_name: "MAISONS TERRE D'OC",
        sector: "Construction de maisons individuelles",
        key_figures: {
          naf_code: "41.20A",
          headcount: 35,
          leader_person: "Julien Anthony Torrecillas",
          leader_role: "Président",
          leader_since: "2019-01-10",
          site_status: "non trouvé",
          site_offer: "Constructeur de maisons ; l'extrait mentionne une étude et la mise en œuvre d'un projet.",
        },
        signals: [{ label: "Effectif d'au moins 35 personnes", source: "Données INSEE" }],
      }),
      null,
      NOW,
    );

    const readiness = hookReadiness(facts.facts);
    check("la fiche est bloquée", !readiness.ready, JSON.stringify(readiness.strong.map((f) => f.key)));
    check("la raison parle d'événement daté", /événement daté/.test(readiness.reason), readiness.reason);

    const site = facts.facts.find((fact) => fact.key === "site_offer");
    check("le fait de site existe toujours", Boolean(site));
    check("mais il n'ouvre pas le mail", site ? !canOpenMail(site) : false);

    // Un dirigeant en poste depuis 2019 n'est pas une arrivée.
    check("sept ans en poste : aucune arrivée", !facts.facts.some((fact) => fact.key === "new_leader"));
  }

  console.log("\n23. « Votre présentation… » est une paraphrase du site");
  {
    const signature = "Axel Remillat\nAutomatisation & IA en production pour PME";
    const mail = (first: string) =>
      `Bonjour,\n\n${first}\n\nJe suis Axel Remillat.\n\nUn flux lirait vos dossiers.\n\nOn en parle ?\n\n${signature}`;

    check(
      "« Votre présentation relie… » est refusé",
      opensOnSiteMention(mail("Votre présentation relie l'étude et la mise en œuvre du projet."), signature),
    );
    check("« votre site » aussi", opensOnSiteMention(mail("Votre site décrit huit implantations."), signature));
    check("« leur plaquette » aussi", opensOnSiteMention(mail("Selon leur plaquette, deux ateliers."), signature));
    check(
      "parler d'eux sans parler de leur communication passe",
      !opensOnSiteMention(mail("Vous construisez des maisons individuelles en Occitanie."), signature),
    );
  }

  console.log("\n24. Anti-homonymie : jamais un mot de leur propre nom");
  {
    // Le bug réel : « maisons » est le mot-tête de MAISONS TERRE D'OC, et une
    // phrase qui le contient sans le reste du nom le faisait bannir.
    check(
      "un fragment du nom n'est pas un homonyme",
      nearbyEntity("Constructeur de maisons individuelles depuis 2019.", "MAISONS TERRE D'OC") === null,
      String(nearbyEntity("Constructeur de maisons individuelles depuis 2019.", "MAISONS TERRE D'OC")),
    );
    check(
      "une vraie autre entreprise reste détectée",
      nearbyEntity("Maisons Pierre ouvre une agence.", "MAISONS TERRE D'OC") === "Maisons Pierre",
      String(nearbyEntity("Maisons Pierre ouvre une agence.", "MAISONS TERRE D'OC")),
    );

    const attached = attachSignals(
      [
        {
          label: "Présentation",
          url: "https://maisons-terre-doc.fr/",
          quote: "Constructeur de maisons individuelles depuis 2019.",
        },
      ],
      { name: "MAISONS TERRE D'OC", siren: "845206317", website: null },
    );
    check("aucun nom interdit tiré de leur nom", attached.foreignEntities.length === 0, JSON.stringify(attached.foreignEntities));
  }

  console.log("\n25. Destinataire : le dirigeant, sauf si le besoin est commercial");
  {
    const commercial = { email: "c@x.fr", full_name: "Claire Vidal", position: "Directrice commerciale", confidence: 95 };
    const ops = { email: "o@x.fr", full_name: "Marc Roux", position: "Directeur des opérations", confidence: 92 };

    check("besoin opérationnel → on passe au décideur", chooseRecipient(commercial, [commercial, ops], "préparer les dossiers de chantier")?.email === ops.email);
    check("besoin commercial → le commercial convient", chooseRecipient(commercial, [commercial, ops], "produire les devis clients")?.email === commercial.email);
    check("pas de décideur → on garde le commercial", chooseRecipient(commercial, [commercial], "préparer les dossiers")?.email === commercial.email);
    // Un agent n'est pas un decideur : on ne descend pas jusqu'a lui.
    const agent = { email: "a@x.fr", full_name: "Lea Blanc", position: "Real Estate Agent", confidence: 99 };
    check(
      "un simple agent ne remplace pas le commercial",
      chooseRecipient(commercial, [commercial, agent], "préparer les dossiers")?.email === commercial.email,
    );
    check("un dirigeant n'est jamais écarté", chooseRecipient(ops, [ops, commercial], "préparer les dossiers")?.email === ops.email);
    check("aucun contact reste aucun contact", chooseRecipient(null, [], "préparer les dossiers") === null);

    check("un devis est un besoin commercial", painIsCommercial("produire un devis à partir d'une demande"));
    check("une prise de rendez-vous aussi", painIsCommercial("caler les rendez-vous de prospection"));
    check("un dossier de chantier, non", !painIsCommercial("constituer les dossiers de chantier"));
    check("« Directrice commerciale » est un poste commercial", isCommercialPosition("Directrice commerciale"));
    check("« Président » ne l'est pas", !isCommercialPosition("Président"));
    check("« Business Development Director » l'est", isCommercialPosition("Business Development Director"));
  }

  console.log("\n26. Ton Direct : « Bonjour prénom », jamais « Monsieur Nom »");
  {
    const facts = buildFacts(prospect(), null, NOW).facts;
    const signature = signatureFor(offer);
    const body = (greeting: string) =>
      `${greeting}\n\nVous préparez des commandes en mars 2026.\n\nJe suis Axel Remillat, je construis des flux.\n\nUn flux lirait vos e-mails, en 2 à 3 semaines.\n\nOn en parle ?\n\n${signature}`;
    const run = (greeting: string, tone: "direct" | "factuel") =>
      validateEmail({ subject: "commandes", body: body(greeting) }, { facts, contact: null, tone, companyName: "X", signature })
        .failures.filter((line) => line.includes("Salutation"))
        .join(" | ");

    check("Direct + « Monsieur » : refusé", run("Bonjour Monsieur Torrecillas,", "direct") !== "", "aucun échec");
    check("Direct + prénom : accepté", run("Bonjour Julien,", "direct") === "", run("Bonjour Julien,", "direct"));
    check("Factuel + « Monsieur » : accepté", run("Bonjour Monsieur Torrecillas,", "factuel") === "");
  }


  console.log("\n27. Une ouverture doit porter le SIREN du prospect");
  {
    // Contrôle réel du 27/09/2026 : Montmoreau (Charente) est à 400 km du siège
    // de SELECTION HABITAT (Rodez), et c'est pourtant bien son établissement —
    // SIRET 45345025600418, confirmé par l'annuaire public. Le rattachement est
    // désormais vérifié dans le code plutôt que supposé.
    const sh = (openings: { city: string; date: string; siret?: string | null; sign?: string | null }[]) =>
      buildFacts(
        prospect({
          company_name: "SELECTION HABITAT",
          siren: "453450256",
          key_figures: { naf_code: "68.31Z", recent_openings: openings },
        }),
        null,
        NOW,
      ).facts.find((fact) => fact.key === "opening");

    const mine = sh([{ city: "Montmoreau", date: "2026-03-01", siret: "45345025600418" }]);
    check("un SIRET du prospect est retenu", Boolean(mine), "aucun fait d'ouverture");
    check("la ville est citée", /Montmoreau/.test(mine?.value ?? ""), mine?.value);

    const foreign = sh([{ city: "Montmoreau", date: "2026-03-01", siret: "99999999900011" }]);
    check("un SIRET étranger est écarté", foreign === undefined, foreign?.value);

    // Fiche enrichie avant que le SIRET ne soit conservé : on ne peut pas
    // vérifier, et la source restait la fiche Pappers du prospect.
    const legacy = sh([{ city: "Perigueux", date: "2026-03-01" }]);
    check("une fiche ancienne reste exploitable", Boolean(legacy), "écartée à tort");

    // Une agence peut porter une autre enseigne que la raison sociale.
    const hamilton = sh([
      { city: "Soorts-Hossegor", date: "2026-01-01", siret: "45345025600442", sign: "Agence Hamilton" },
    ]);
    check(
      "l'enseigne locale est donnée au rédacteur",
      /Agence Hamilton/.test(hamilton?.writerHint ?? ""),
      hamilton?.writerHint,
    );
    const same = sh([
      { city: "Lauzerte", date: "2026-01-01", siret: "45345025600459", sign: "SELECTION HABITAT" },
    ]);
    check("une enseigne identique n'est pas répétée", !/enseigne/.test(same?.writerHint ?? ""), same?.writerHint);
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
