/**
 * PARCOURS E2E DU CRM (Cowork #117), Playwright, en MODE DÉMO LOCAL : aucune base, aucun compte, aucun appel payant.
 *
 *   ORION_DEMO=1 npx next dev -p 3117                       # dans un terminal (jamais pendant un build)
 *   PLAYWRIGHT_CORE=<chemin de playwright-core> node scripts/crm.e2e.mjs [--captures <dossier>]
 *
 * Variables : BASE_URL (défaut http://localhost:3117), PLAYWRIGHT_CORE (défaut : le paquet `playwright-core`).
 * Vérifie : la barre (Aujourd'hui, CRM, Opportunités, Réglages ; plus de Cockpit ni de Pipeline), la création
 * rapide d'une fiche, la chronologie, la prochaine action qui remonte dans Aujourd'hui puis « Fait », le
 * déplacement d'étape (tableau et kanban), et l'interrupteur de pause (HTTP 423 sur les routes payantes).
 * Pas dans la CI (Playwright n'est pas une dépendance du projet) : à lancer en local, résultat dans la PR.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const BASE = process.env.BASE_URL || "http://localhost:3117";
const iCap = process.argv.indexOf("--captures");
const CAPTURES = iCap > 0 ? process.argv[iCap + 1] : null;
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

let echecs = 0;
const check = (nom, ok, detail) => {
  console.log(`  ${ok ? "ok   " : "ÉCHEC"} ${nom}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) echecs += 1;
};
/** Le tableau rend une carte (téléphone) ET une ligne (bureau) par fiche : on ne garde que la version visible. */
const visible = (page, texte) => page.getByText(texte).locator("visible=true").first();
const capture = async (page, nom) => {
  if (CAPTURES) await page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: true });
};
const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const navigateur = await chromium.launch();
try {
  for (const [nomVue, viewport] of [
    ["bureau", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    console.log(`\n${nomVue} (${viewport.width} px)`);
    const ctx = await navigateur.newContext({ viewport, locale: "fr-FR", deviceScaleFactor: nomVue === "mobile" ? 2 : 1 });
    const page = await ctx.newPage();
    const erreursConsole = [];
    page.on("pageerror", (e) => erreursConsole.push(e.message));

    // Barre de navigation.
    await page.goto(`${BASE}/crm`, { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "Navigation principale" });
    const onglets = (await nav.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    check("barre : Aujourd'hui, CRM, Opportunités, Réglages", ["Aujourd’hui", "Aujourd'hui"].some((a) => onglets[0] === a) && onglets.slice(1).join(",") === "CRM,Opportunités,Réglages", onglets);
    check("lien Archives › Prospection e-mail présent", (await page.locator('a[href="/archives/prospection-email"]').count()) === 1);
    const ongletCrm = await nav.getByRole("link", { name: "CRM" }).boundingBox();
    const crmAuPremierPlan = ongletCrm
      ? await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('a[href="/crm"]')), { x: ongletCrm.x + ongletCrm.width / 2, y: ongletCrm.y + ongletCrm.height / 2 })
      : false;
    check("onglet CRM visible sans faire défiler la barre", Boolean(ongletCrm && ongletCrm.x + ongletCrm.width <= viewport.width && crmAuPremierPlan), ongletCrm);
    check("CRM : Optique des Alpes listée", await visible(page, "Optique des Alpes").isVisible());
    const largeur = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("pas de défilement horizontal", largeur <= 0, largeur);
    await capture(page, `${nomVue}-crm-tableau`);

    // Recherche instantanée.
    await page.getByPlaceholder("Nom, ville, métier, téléphone…").fill("mure");
    check("recherche instantanée (sans accents ni casse)", await visible(page, "Optique des Alpes").isVisible());
    await page.getByPlaceholder("Nom, ville, métier, téléphone…").fill("");

    // Création rapide.
    const nom = `Boulangerie Test ${nomVue} ${Date.now().toString(36).slice(-4)}`;
    await page.getByRole("button", { name: "Nouvelle fiche" }).click();
    await page.locator("#rapide-nom").fill(nom);
    await page.locator("#rapide-metier").fill("Boulangerie");
    await page.locator("#rapide-ville").fill("Grenoble");
    await page.locator("#rapide-action").fill("Passer avec la maquette");
    await page.locator("#rapide-action-le").fill(jour);
    await page.getByRole("button", { name: "Créer et ouvrir" }).click();
    await page.waitForURL(/\/crm\/[^/]+$/, { timeout: 20_000 });
    check("fiche créée et ouverte", await page.getByRole("heading", { name: nom }).isVisible());

    // Chronologie.
    await page.locator("#evt-type").selectOption("appel");
    await page.locator("#evt-contenu").fill("Intéressée, rappeler après la fournée");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await page.getByText("Intéressée, rappeler après la fournée").waitFor({ timeout: 15_000 });
    check("chronologie : appel ajouté", true);

    // Étape depuis la fiche.
    await page.getByLabel("Changer l'étape").selectOption("contacte");
    await page.getByText("À contacter → Contacté").waitFor({ timeout: 15_000 });
    check("étape : changement tracé dans la chronologie", true);
    await capture(page, `${nomVue}-fiche-chronologie`);

    // Aujourd'hui : la prochaine action remonte, puis « Fait ».
    await page.goto(`${BASE}/aujourdhui`, { waitUntil: "networkidle" });
    const carte = page.locator("li", { hasText: nom });
    check("Aujourd'hui : la relance du jour apparaît", await carte.first().isVisible());
    await capture(page, `${nomVue}-aujourdhui`);
    await carte.getByRole("button", { name: "Fait" }).click();
    await carte.getByRole("button", { name: "Valider" }).click();
    await page.locator("li", { hasText: nom }).first().waitFor({ state: "detached", timeout: 15_000 });
    check("« Fait » : la tâche quitte Aujourd'hui", true);

    // Kanban : déplacer au doigt (menu « Déplacer vers… »).
    await page.goto(`${BASE}/crm`, { waitUntil: "networkidle" });
    await page.getByRole("radio", { name: "Kanban" }).click();
    const menu = page.getByLabel(`Déplacer ${nom} vers`);
    await menu.selectOption("rdv");
    await page.getByRole("region", { name: "Pipeline en colonnes" }).locator('[aria-label^="RDV"]').getByRole("link", { name: nom }).waitFor({ timeout: 15_000 });
    check("kanban : fiche déplacée en RDV", true);
    const largeurKanban = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check("kanban : défilement dans les colonnes, pas dans la page", largeurKanban <= 0, largeurKanban);
    await capture(page, `${nomVue}-crm-kanban`);
    await page.getByRole("radio", { name: "Tableau" }).click();

    // Interrupteur de pause : aucune route payante ne répond autre chose que 423.
    for (const route of ["/api/emails/generate", "/api/prospects/enrich", "/api/prospects/search", "/api/search/runs"]) {
      const r = await page.request.post(`${BASE}${route}`, { data: {} });
      check(`pause : ${route} → 423`, r.status() === 423, r.status());
    }
    check("aucune erreur JavaScript", erreursConsole.length === 0, erreursConsole);
    await ctx.close();
  }
} finally {
  await navigateur.close();
}
console.log(echecs ? `\n${echecs} échec(s).` : "\nParcours e2e du CRM : tout passe.");
process.exit(echecs ? 1 : 0);
