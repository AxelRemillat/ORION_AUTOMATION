/**
 * Tests de la recherche : zone, déduplication, boucle de scan, datation des
 * offres, couleurs canvas.
 *
 * Chaque bloc correspond à un symptôme observé en production. Les fixer ici
 * est le seul moyen de garantir qu'ils ne reviennent pas — en particulier le
 * « Paris » qui partait en recherche plein texte, invisible tant qu'on ne
 * regardait pas les paramètres envoyés.
 *
 * La résolution de zone tape le VRAI service geo.api.gouv.fr : c'est un
 * contrat externe, et le tester sur un bouchon ne prouverait rien. Il est
 * gratuit et sans clé.
 *
 * Exécution : `npm run test:recherche`.
 */
import { buildSearchParams, pageCount, ANNUAIRE_RESULT_CAP } from "../lib/enrichment/gouv";
import { resolveZone } from "../lib/enrichment/geo";
import {
  filterCandidates,
  pagePlan,
  plannedPages,
  scanBudget,
  searchSeed,
  shouldContinue,
} from "../lib/enrichment/scan-plan";
import { parseJobPostings, postingFreshness, sameDomain } from "../lib/enrichment/job-posting";
import { jobUrlsFromSitemap } from "../lib/enrichment/site";
import { whyNow } from "../lib/scoring";
import { toCanvasColor, toRgbTriplet } from "../lib/canvas-color";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("\n1. Résolution de zone (appels réels à geo.api.gouv.fr)");
  {
    const paris = await resolveZone("Paris");
    check("Paris est résolu", paris.ok, paris.ok ? "" : paris.error);
    if (paris.ok) {
      check("libellé « Paris (75) »", paris.data.label === "Paris (75)", paris.data.label);
      check("filtre par codes postaux", paris.data.param === "code_postal", paris.data.param);
      check(
        "les arrondissements sont couverts",
        paris.data.value.split(",").length >= 20,
        `${paris.data.value.split(",").length} code(s)`,
      );
    }

    const dept = await resolveZone("69");
    check("le département 69 est résolu", dept.ok, dept.ok ? "" : dept.error);
    if (dept.ok) {
      check("filtre départemental", dept.data.param === "departement" && dept.data.value === "69");
      check("libellé avec le nom", dept.data.label.includes("(69)"), dept.data.label);
    }

    const postal = await resolveZone("69003");
    check("le code postal 69003 est résolu", postal.ok, postal.ok ? "" : postal.error);
    if (postal.ok) {
      check("Lyon est reconnu derrière 69003", postal.data.label.startsWith("Lyon"), postal.data.label);
      check("département déduit", postal.data.departement === "69", String(postal.data.departement));
    }

    const lyon = await resolveZone("Lyon");
    check("Lyon est résolu", lyon.ok, lyon.ok ? "" : lyon.error);
    if (lyon.ok) {
      check("les arrondissements de Lyon sont couverts", lyon.data.value.split(",").length >= 9);
    }

    const unknown = await resolveZone("Zorglub-sur-Mer");
    check("une zone inconnue échoue proprement", !unknown.ok);
    check(
      "le message oriente l'utilisateur",
      !unknown.ok && unknown.error.includes("code postal"),
      unknown.ok ? "" : unknown.error,
    );
  }

  console.log("\n2. Paramètres envoyés à l'annuaire");
  {
    const built = buildSearchParams(
      { section: "C", tranches: ["11", "12"] },
      {
        page: 3,
        perPage: 20,
        zone: {
          kind: "commune",
          label: "Paris (75)",
          param: "code_postal",
          value: "75001,75002",
          departement: "75",
        },
      },
    );
    check("les paramètres sont construits", !("error" in built));
    if (!("error" in built)) {
      const params = built.params;
      check("la zone est un filtre, pas du texte", params.get("code_postal") === "75001,75002");
      check("la zone n'entre JAMAIS dans q", params.get("q") === null, String(params.get("q")));
      check("la page demandée est respectée", params.get("page") === "3", String(params.get("page")));
      check("le filtre géo est signalé", built.geoFiltered);
    }

    const noZone = buildSearchParams({ section: "C" }, {});
    check("sans zone, aucun filtre géo", !("error" in noZone) && !noZone.geoFiltered);

    const empty = buildSearchParams({}, {});
    check("sans aucun critère, on refuse", "error" in empty);
  }

  console.log("\n3. Pagination : le total plafonné ne crée pas de pages fantômes");
  {
    check("10 000 / 20 = 500 pages", pageCount(ANNUAIRE_RESULT_CAP, 20) === 500);
    check("un total supérieur au plafond ne dépasse pas", pageCount(250_000, 20) === 500);
    check("un petit total donne peu de pages", pageCount(37, 20) === 2);
    check("jamais zéro page", pageCount(0, 20) === 1);
  }

  console.log("\n4. Plan de pages : varié, mais reproductible");
  {
    const seedA = searchSeed(["C", "11,12", "75001"], "2026-09-24");
    const seedB = searchSeed(["C", "11,12", "75001"], "2026-09-24");
    const seedC = searchSeed(["C", "11,12", "75001"], "2026-09-25");
    check("mêmes critères, même jour → même graine", seedA === seedB);
    check("le lendemain, graine différente", seedA !== seedC);

    const planA = pagePlan(seedA, 40, 5);
    check("le plan est reproductible", planA.join(",") === pagePlan(seedB, 40, 5).join(","));
    check("le plan varie d'un jour à l'autre", planA.join(",") !== pagePlan(seedC, 40, 5).join(","));
    check("aucune page en double", new Set(planA).size === planA.length, planA.join(","));
    check("la page 1 est visitée", planA.includes(1), planA.join(","));
    check("les pages restent dans les bornes", planA.every((page) => page >= 1 && page <= 40));
    check("une seule page disponible → plan d'une page", pagePlan(seedA, 1, 5).join(",") === "1");
  }

  console.log("\n5. Déduplication des SIREN");
  {
    const exclude = new Set(["111111111", "222222222"]);
    const seen = new Set<string>();
    const first = filterCandidates(
      [
        { siren: "111111111", company_name: "Déjà prospect" },
        { siren: "333333333", company_name: "Nouvelle" },
        { siren: null, company_name: "Sans SIREN" },
      ],
      { exclude, seen },
    );
    check("l'entreprise déjà connue est écartée", first.kept.length === 2, String(first.kept.length));
    check("elle est comptée", first.skippedKnown === 1, String(first.skippedKnown));
    check("une entreprise sans SIREN est gardée", first.kept.some((c) => c.siren === null));

    const second = filterCandidates(
      [
        { siren: "333333333", company_name: "Nouvelle" },
        { siren: "444444444", company_name: "Encore une" },
      ],
      { exclude, seen },
    );
    check("un doublon entre deux pages ne repasse pas", second.kept.length === 1, String(second.kept.length));
    check("ce n'est pas compté comme « déjà connue »", second.skippedKnown === 0);
  }

  console.log("\n6. Boucle de scan : arrêt objectif / plafond / annuaire");
  {
    check("plafond = 3× la largeur", scanBudget(20) === 60);
    check(
      "le plan prévoit de la marge pour la déduplication",
      plannedPages(60, 20, 109) === 9,
      String(plannedPages(60, 20, 109)),
    );
    check("il ne dépasse jamais les pages réelles", plannedPages(60, 20, 4) === 4);

    const goal = shouldContinue({ scanned: 12, withSignal: 5, pagesRead: 2 }, 5, 60, 40);
    check("objectif atteint → on s'arrête", !goal.go && goal.stop === "objectif");

    const cap = shouldContinue({ scanned: 60, withSignal: 1, pagesRead: 3 }, 5, 60, 40);
    check("plafond atteint → on s'arrête", !cap.go && cap.stop === "plafond");

    const exhausted = shouldContinue({ scanned: 20, withSignal: 0, pagesRead: 40 }, 5, 60, 40);
    check("annuaire épuisé → on s'arrête", !exhausted.go && exhausted.stop === "annuaire");

    const carryOn = shouldContinue({ scanned: 20, withSignal: 1, pagesRead: 1 }, 5, 60, 40);
    check("objectif non atteint et budget restant → on continue", carryOn.go);
  }

  console.log("\n7. Offres d'emploi : JSON-LD et fraîcheur");
  {
    const html = `
      <script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"JobPosting","title":"Automaticien/ne","datePosted":"2026-09-01","validThrough":"2026-12-31"}
        ]}
      </script>`;
    const postings = parseJobPostings(html);
    check("l'offre est trouvée dans un @graph", postings.length === 1, String(postings.length));
    check("datePosted est lue", postings[0]?.datePosted === "2026-09-01", String(postings[0]?.datePosted));
    check("validThrough est lue", postings[0]?.validThrough === "2026-12-31");
    check("le BreadcrumbList est ignoré", postings.every((posting) => posting.title !== null));

    check("un JSON-LD invalide ne fait pas tomber", parseJobPostings("<script type=\"application/ld+json\">{oops</script>").length === 0);
    check("une page sans JSON-LD rend une liste vide", parseJobPostings("<html></html>").length === 0);

    const now = new Date("2026-09-24");
    check(
      "offre datée",
      postingFreshness({ reachable: true, onOfficialDomain: true, facts: postings[0], now }) === "datée",
    );
    check(
      "offre périmée",
      postingFreshness({
        reachable: true,
        onOfficialDomain: true,
        facts: { datePosted: null, validThrough: "2026-01-01", title: null },
        now,
      }) === "périmée",
    );
    check(
      "offre en ligne sans date, sur le domaine officiel",
      postingFreshness({ reachable: true, onOfficialDomain: true, facts: null, now }) === "en ligne",
    );
    check(
      "hors domaine officiel, une offre non datée ne compte pas",
      postingFreshness({ reachable: false, onOfficialDomain: false, facts: null, now }) === "introuvable",
    );

    check(
      "le domaine officiel est reconnu",
      sameDomain("https://www.blue-enerfreeze.com/offre-demploi-automaticienne", "https://www.blue-enerfreeze.com"),
    );
    check("un agrégateur ne l'est pas", !sameDomain("https://indeed.fr/offre", "https://www.blue-enerfreeze.com"));
  }

  console.log("\n8. Couleurs canvas");
  {
    // Le format exact du token qui faisait planter addColorStop.
    check(
      "un token « r g b » devient un rgba valide",
      toCanvasColor("52 198 222", 0.2) === "rgba(52, 198, 222, 0.2)",
      toCanvasColor("52 198 222", 0.2),
    );
    check("virgules acceptées", toCanvasColor("52, 198, 222", 1) === "rgba(52, 198, 222, 1)");
    check("hex long accepté", toCanvasColor("#34c6de", 1) === "rgba(52, 198, 222, 1)");
    check("hex court accepté", toCanvasColor("#fff", 1) === "rgba(255, 255, 255, 1)");
    check("rgb() accepté", toCanvasColor("rgb(52 198 222)", 0.5) === "rgba(52, 198, 222, 0.5)");
    check("rgba() accepté", toCanvasColor("rgba(52, 198, 222, 0.9)", 0.1) === "rgba(52, 198, 222, 0.1)");
    check("triplet accepté", toCanvasColor([52, 198, 222], 0) === "rgba(52, 198, 222, 0)");
    check("token absent → repli, jamais d'exception", toCanvasColor("", 0.4) === "rgba(128, 128, 128, 0.4)");
    check("alpha hors bornes ramené", toCanvasColor("#000", 5) === "rgba(0, 0, 0, 1)");
    check("valeur illisible → null", toRgbTriplet("bleu ciel") === null);
  }


  console.log("\n9. Sitemap : les offres que le HTML ne lie pas");
  {
    const xml = `<urlset>
      <url><loc>https://www.exemple.fr/</loc></url>
      <url><loc>https://www.exemple.fr/nous-rejoindre</loc></url>
      <url><loc>https://www.exemple.fr/offre-demploi-automaticienne</loc></url>
      <url><loc>https://www.exemple.fr/en/job-offer-automation</loc></url>
      <url><loc>https://autre-site.fr/offre-demploi-x</loc></url>
    </urlset>`;

    // Le sitemap est servi en « www », le crawl se fait sur le domaine nu :
    // comparer les origines telles quelles rejetait TOUTES les URLs.
    const urls = jobUrlsFromSitemap(xml, "https://exemple.fr", 3);
    check("l'offre est trouvée malgré le www", urls.includes("https://exemple.fr/offre-demploi-automaticienne"), urls.join(" "));
    check("elle passe avant la page d'index", urls[0]?.includes("offre-demploi"), urls.join(" "));
    check("les traductions sont écartées", !urls.some((url) => url.includes("/en/")), urls.join(" "));
    check("un autre domaine est écarté", !urls.some((url) => url.includes("autre-site")), urls.join(" "));
    check("aucun sitemap → aucune URL", jobUrlsFromSitemap("", "https://exemple.fr").length === 0);
  }

  console.log("\n10. Accroche : le poste automatisable passe devant");
  {
    const posting = (title: string, category: string) => ({
      type: "recrutement",
      label: `Poste ouvert : ${title} — exemple.fr, en ligne, non datée`,
      url: `https://exemple.fr/offre-${category}`,
      quote: `Offre d'emploi - ${title} chez Exemple, poste basé à Lyon`,
      confidence: 0.85,
      category,
      liveOnOfficialSite: true,
      structured: true,
    });

    const why = whyNow([posting("Manager énergie", "other"), posting("Automaticien/ne", "automation")]);
    check("l'automaticien est retenu", why?.role === "Automaticien/ne", String(why?.role));
    check("l'état remplace la date absente", why?.when === "en ligne, non datée", String(why?.when));

    // Une citation qui ne survit pas au nettoyage n'est pas une preuve.
    const empty = whyNow([{ ...posting("X", "ops"), quote: "- [](https://x.fr) **" }]);
    check("une citation vidée par le nettoyage est refusée", empty === null);
  }

  console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
