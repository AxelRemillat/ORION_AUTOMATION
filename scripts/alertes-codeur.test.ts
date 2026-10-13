/**
 * ALERTES CODEUR RATÉES (Cowork #27) — non-régression.
 *
 * Le 13/10/2026, deux annonces faites pour Axel n'ont déclenché aucune notification :
 *   - 491216 « Amélioration visuelle d'un site CMS Grav » (500 € à 1 000 €) ;
 *   - 491205 « Developpements web application médicale - PREMIUM » (Next.js, Node, React).
 * Cause : l'alerte e-mail Codeur arrivait AVANT le flux RSS et créait une fiche « titre
 * seul » ; l'item RSS complet qui suivait était jeté comme doublon — jamais analysé.
 *
 * Fixtures : les items RSS réels (flux public), un faux modèle, une fausse base.
 * Aucun réseau, aucun appel LLM, aucun envoi. `npm run test:alertes-codeur`
 */
import type { AskFn } from "../lib/ai/chat";
import { parseCodeurRss } from "../lib/opportunities/codeur-rss";
import { ingestOpportunity, laneVerdict, type IngestBody, type IngestDeps } from "../lib/opportunities/ingest";
import { isRegie, laneOf, REGIE_BADGE } from "../lib/opportunities/lane";
import { classifyAd } from "../lib/opportunities/prefilter";
import { runAlertCatchUp, RATTRAPAGE_KEY } from "../lib/opportunities/rattrapage-alertes";
import type { Notification } from "../lib/notify/ntfy";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const NOW = new Date("2026-10-13T15:00:00.000Z");

// Les deux items tels que le flux RSS officiel les publie (titres doublement échappés compris).
const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<item>
  <title>Amélioration visuelle d&amp;#39;un site CMS Grav RacinesduCiel..com</title>
  <link>https://www.codeur.com/projects/491216-amelioration-visuelle-d-un-site-cms-grav-racinesduciel-com</link>
  <pubDate>Tue, 13 Oct 2026 16:31:58 +0200</pubDate>
  <guid>491216</guid>
  <description type="html"><![CDATA[<p>Budget : 500 € à 1 000 € - Catégories : CSS, HTML, XML, CMS, Integration HTML, Landing page, Web design</p> <p> Bonjour, Je dirige Racines du Ciel, une pratique artistique participative, et je cherche quelqu&#39;un pour affiner l&#39;aspect visuel de notre site racinesduciel.com, déjà sous Grav. Il ne s&#39;agit pas d&#39;une refonte, … </p> <p> <a href="https://www.codeur.com/projects/491216">Voir ce projet sur Codeur</a></p>]]></description>
</item>
<item>
  <title>Developpements web application médicale - PREMIUM</title>
  <link>https://www.codeur.com/projects/491205-developpements-web-application-medicale</link>
  <pubDate>Tue, 13 Oct 2026 14:17:30 +0200</pubDate>
  <guid>491205</guid>
  <description type="html"><![CDATA[<p>Budget : 500 € à 1 000 € - Catégories : Développement spécifique, Node.js, Full-stack, Back-end, React</p> <p> MEDICODE développe des applications médicales et est spécialisée dans le domaine de l&#39;obstétrique. Stack technique - Front-end : Next.js (App Router), … </p> <p> <a href="https://www.codeur.com/projects/491205">Voir ce projet sur Codeur</a></p>]]></description>
</item>
</channel></rss>`;

const items = parseCodeurRss(FEED);
const grav = items.find((item) => item.external_id === "491216") as IngestBody;
const medical = items.find((item) => item.external_id === "491205") as IngestBody;

/** Faux modèle : 9/10 pour l'application médicale (sa stack), 6/10 sinon ; propositions vides. */
const ask: AskFn = async (role, _system, user) => {
  if (role !== "judge") return "";
  const score = /m[ée]dical/i.test(user) ? 9 : 6;
  return JSON.stringify({ score, reasons: ["Stack Next.js / Node", "Application métier", "Budget cohérent"], need: "Application web", demo: "general", language: "fr", kind: "fullstack" });
};

const titleOnlyRow = (item: IngestBody, extra: Record<string, unknown> = {}) => ({
  id: `fiche-${item.external_id}`,
  user_id: "u1",
  platform: "codeur",
  external_id: item.external_id,
  source: "email",
  title: item.title,
  body: item.title,
  budget: null,
  categories: [],
  status: "a_repondre",
  analysis_state: "titre_seul",
  filter_reason: null,
  fit_score: null,
  created_at: "2026-10-13T14:33:02.000Z",
  published_at: item.published_at,
  ...extra,
});

function deps(db: FakeDb, notes: Notification[], over: Partial<IngestDeps> = {}): IngestDeps {
  return { db: db as never, userId: "u1", ask, baseUrl: "https://orion.example", now: () => NOW, notify: async (n) => void notes.push(n), ...over };
}

async function main(): Promise<void> {
  console.log("\n1. Lecture du flux RSS officiel");
  check("les deux items sont lus", items.length === 2, items.map((item) => item.external_id));
  check("titre doublement échappé décodé (« d'un site »)", grav.title === "Amélioration visuelle d'un site CMS Grav RacinesduCiel..com", grav.title);
  check("budget extrait de la 1re ligne", grav.budget_text === "500 € à 1 000 €", grav.budget_text);
  check("catégories extraites", grav.categories.includes("Integration HTML") && grav.categories.length === 7, grav.categories);
  check("texte de l'annonce sans le lien « Voir ce projet »", grav.description.startsWith("Bonjour, Je dirige") && !/Voir ce projet/.test(grav.description), grav.description.slice(0, 60));
  check("extrait tronqué repéré (« … »)", grav.description_truncated === true);

  console.log("\n2. Les règles (Cowork #27)");
  const gravClass = classifyAd({ title: grav.title, description: grav.description, categories: grav.categories, budgetText: grav.budget_text });
  check("Grav est un CMS", gravClass.cms);
  check("« amélioration visuelle » d'un site est du dev web", gravClass.webDev);
  check("491216 Grav → Lancement (alerte)", laneOf({ ...grav, platform: "codeur", budget: grav.budget_text }, NOW) === "lancement");
  check("« PREMIUM » dans le titre n'exclut rien", classifyAd({ title: medical.title, description: medical.description, categories: medical.categories, budgetText: medical.budget_text }).reason === null);
  check("WordPress n'est plus « À voir » : Lancement", laneOf({ platform: "codeur", title: "Site WordPress : changer le menu et le thème", description: "Petites retouches sur notre site WordPress.", categories: [], budget: "Moins de 500 €" }, NOW) === "lancement");
  const regie = "Mission en régie 3 à 4 jours par semaine, TJM 200 à 500 €/jour. Stack : Next.js, NestJS, Prisma, IA.";
  check("régie / TJM / « jours par semaine » sur la stack d'Axel → régie", isRegie(regie));
  check("… et la catégorie « regie » donne une alerte", laneVerdict(laneOf({ platform: "codeur", title: "Développements web application médicale", description: regie, categories: [], budget: "200 € à 500 € / jour" }, NOW), null) === "alerte");
  check("badge « Régie · dispo à vérifier »", REGIE_BADGE === "Régie · dispo à vérifier");
  check("régie HORS de sa stack (Java / Spring) : pas d'alerte régie", !isRegie("Régie 5 jours par semaine, TJM 450 €, Java Spring Boot"));

  console.log("\n3. Hors cible : toujours pas d'alerte");
  for (const [title, description] of [
    ["Téléprospecteur(trice) B2B indépendant(e) centre de formation", "Prospection téléphonique de centres de formation, rémunération à la commission."],
    ["Montage vidéo premium pour YouTube", "Montage de 10 vidéos par mois, motion design."],
  ] as const) {
    const cls = classifyAd({ title, description, categories: [], budgetText: "500 € à 1 000 €" });
    check(`« ${title.slice(0, 40)} » reste écartée`, cls.reason !== null && laneOf({ platform: "codeur", title, description, categories: [], budget: "500 € à 1 000 €" }, NOW) === null, cls.reason);
  }

  console.log("\n4. La cause : l'e-mail « titre seul » arrivé avant le flux RSS");
  {
    const db = new FakeDb({ opportunities: [titleOnlyRow(grav), titleOnlyRow(medical)], notification_log: [] }, { unique: { notification_log: ["key"] } });
    const notes: Notification[] = [];
    const gravResult = await ingestOpportunity(deps(db, notes), grav);
    check("491216 : l'item RSS n'est PLUS un doublon", !gravResult.duplicate, gravResult);
    check("491216 : verdict « alerte » renvoyé à n8n (qui notifie)", gravResult.verdict === "alerte", gravResult.verdict);
    const gravRow = db.rows("opportunities").find((row) => row.external_id === "491216")!;
    check("491216 : la fiche est complétée (budget, catégories, texte)", gravRow.budget === "500 € à 1 000 €" && (gravRow.categories as string[]).length === 7 && String(gravRow.body).startsWith("Bonjour"), gravRow);
    check("491216 : elle n'est plus « titre seul »", gravRow.analysis_state !== "titre_seul", gravRow.analysis_state);

    const medicalResult = await ingestOpportunity(deps(db, notes), medical);
    check("491205 : analysée (9/10) → « alerte »", medicalResult.verdict === "alerte" && medicalResult.score === 9, medicalResult);

    const again = await ingestOpportunity(deps(db, notes), grav);
    check("second passage du même item (2e flux) : doublon, pas de seconde analyse", again.duplicate === true);
  }

  console.log("\n5. Analyse trop lente : l'alerte n'est plus perdue");
  {
    const db = new FakeDb({ opportunities: [], notification_log: [] }, { unique: { notification_log: ["key"] } });
    const notes: Notification[] = [];
    const background: Promise<unknown>[] = [];
    const slowAsk: AskFn = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return ask(...args);
    };
    const fresh = { ...medical, external_id: "999001" };
    const result = await ingestOpportunity(deps(db, notes, { ask: slowAsk, deadlineMs: 10, background: (work) => void background.push(work) }), fresh);
    check("réponse à n8n avant la fin de l'analyse (« en cours »)", result.pending === true && result.verdict === "a_voir", result);
    await Promise.all(background);
    check("à la fin de l'analyse (9/10), ORION notifie lui-même — une fois", notes.length === 1 && /9\/10/.test(notes[0].title), notes.map((n) => n.title));
  }

  console.log("\n6. Rattrapage unique (48 h, flux RSS officiel, une notification récapitulative)");
  {
    const db = new FakeDb(
      { opportunities: [titleOnlyRow(grav), titleOnlyRow(medical), titleOnlyRow({ ...grav, external_id: "400000", title: "Annonce sortie du flux" } as IngestBody)], notification_log: [] },
      { unique: { notification_log: ["key"] } },
    );
    const notes: Notification[] = [];
    const feedFetch = (async () => new Response(FEED, { status: 200 })) as unknown as typeof fetch;
    const first = await runAlertCatchUp(deps(db, notes), feedFetch);
    check("deux offres ratées passent en alerte", first.alerts.length === 2, first.alerts);
    check("UNE seule notification, récapitulative", notes.length === 1 && /2 offres ratées en alerte/.test(notes[0].title), notes.map((n) => n.title));
    check("l'annonce sortie du flux reste « titre seul » (rien inventé)", db.rows("opportunities").find((row) => row.external_id === "400000")?.analysis_state === "titre_seul");
    check("verrou posé en base", db.rows("notification_log").some((row) => row.key === RATTRAPAGE_KEY));
    const second = await runAlertCatchUp(deps(db, notes), feedFetch);
    check("second déclenchement : rien (verrou), aucune notification de plus", !second.ran && notes.length === 1);
  }

  console.log(failures === 0 ? "\nTous les tests des alertes Codeur passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
