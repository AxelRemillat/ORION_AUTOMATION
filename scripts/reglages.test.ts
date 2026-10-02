/**
 * Lot 3 — Réglages. Fixtures seulement : faux fetch, faux DNS, fausse base.
 * Aucun appel réseau, aucun crédit. `npm run test:reglages`
 */
import { readFileSync } from "node:fs";
import { NAV_ITEMS } from "../components/layout/nav-items";
import { budgets, monthlyCosts } from "../lib/settings/costs";
import { checkDomain, judgeDkim, judgeDmarc, judgeSpf } from "../lib/settings/dns";
import { describeHttp, integrationStatuses } from "../lib/settings/integrations";
import { loadIntegrations, testIntegration } from "../lib/settings/integrations-server";
import { buildVolumes, csvCell, isBounce, prospectsCsv } from "../lib/settings/volumes";
import { FakeDb } from "./fake-supabase";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const SECRET = "sk-test-NE-DOIT-JAMAIS-SORTIR-1234";

async function main() {
  console.log("\n1. Données : volumes, rebonds, export CSV");
  {
    const volumes = buildVolumes({
      prospects: [{ status: "nouveau" }, { status: "contacte" }, { status: "contacte", do_not_contact: true }] as never,
      messages: [{ status: "sent" }, { status: "sent" }, { status: "sent" }, { status: "draft", send_status: "failed" }, { status: "draft" }],
      inbound: [
        { from_email: "dg@artflex.fr", subject: "Re: votre message" },
        { from_email: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)" },
        { from_email: "contact@x.fr", subject: "Undeliverable: Bonjour" },
      ],
      tags: ["Email manquant", "Email manquant", "Profil à compléter"],
    });
    check("prospects, statuts, « ne plus contacter »", volumes.prospects === 3 && volumes.byStatus.find((row) => row.status === "contacte")?.count === 2 && volumes.doNotContact === 1);
    check("envois, échecs, réponses (hors rebonds)", volumes.sent === 3 && volumes.failed === 1 && volumes.replies === 1, volumes);
    check("rebonds : mailer-daemon et « Undeliverable », taux sur les envois", volumes.bounces === 2 && Math.abs((volumes.bounceRate ?? 0) - 2 / 3) < 1e-9);
    check("étiquettes de « Aujourd'hui », triées", volumes.byTag[0].tag === "Email manquant" && volumes.byTag[0].count === 2);
    check("une vraie réponse n'est pas un rebond", !isBounce({ from_email: "postmaster.dupont@gmail.com", subject: "Bonjour" }));
    check("sans envoi : taux de rebond inconnu (pas 0)", buildVolumes({ prospects: [], messages: [], inbound: [], tags: [] }).bounceRate === null);

    check("CSV : formule neutralisée (pas d'exécution dans le tableur)", csvCell("=HYPERLINK(\"x\")") === `"'=HYPERLINK(""x"")"`, csvCell("=HYPERLINK(\"x\")"));
    check("CSV : séparateur et guillemets échappés", csvCell("A; B") === '"A; B"' && csvCell('dit "oui"') === '"dit ""oui"""');
    const csv = prospectsCsv([{ company_name: "ARTFLEX", siren: "520644386", status: "contacte", email: "contact@artflex.fr", city: "Décines", do_not_contact: false }]);
    check("CSV : BOM UTF-8, en-tête, « ; », accents conservés", csv.startsWith("﻿company_name;siren;status") && csv.includes("ARTFLEX;520644386;contacte;contact@artflex.fr;;Décines"), csv.slice(0, 120));
  }

  console.log("\n2. Coûts : par fournisseur et par mois, budgets");
  {
    const rows = [
      { service: "openai", cost: 1.2, created_at: "2026-10-02T10:00:00Z" },
      { service: "hunter", cost: 0.025, created_at: "2026-09-30T22:30:00Z" }, // 00 h 30 le 1er octobre à Paris
      { service: "pappers", cost: "0.06", created_at: "2026-09-15T10:00:00Z" },
      { service: "inconnu", cost: 99, created_at: "2026-10-01T10:00:00Z" },
    ];
    const months = monthlyCosts(rows, 6, new Date("2026-10-03T10:00:00Z"));
    check("six mois, le plus récent d'abord", months.length === 6 && months[0].month === "2026-10" && months[5].month === "2026-05");
    check("octobre (Paris) : OpenAI + Hunter de 00 h 30", months[0].byProvider.openai.eur === 1.2 && months[0].byProvider.hunter.calls === 1 && months[0].total === 1.23, months[0]);
    check("septembre : Pappers ; service inconnu ignoré", months[1].byProvider.pappers.eur === 0.06 && months[1].total === 0.06);
    const list = budgets({ OPENAI_MONTHLY_BUDGET_EUR: "20", HUNTER_SEARCH_EUR: "0.025", OPENAI_API_KEY: SECRET }, 50);
    check("budgets : Hunter 50/jour, OpenAI 20 €, forfaits", list.some((b) => b.value === "50") && list.some((b) => b.value === "20 €") && list.some((b) => b.value.includes("2 000")));
    check("budgets : jamais une clé", !JSON.stringify(list).includes(SECRET));
  }

  console.log("\n3. Intégrations : état, dernier appel, aucune clé exposée");
  {
    const env = { OPENAI_API_KEY: SECRET, HUNTER_API_KEY: SECRET, N8N_WEBHOOK_SEND_URL: "https://n8n/secret-path", NEXT_PUBLIC_SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE: SECRET };
    const statuses = integrationStatuses(env, { openai: "2026-10-02T10:00:00Z", n8n_envoi: "2026-10-01T07:00:08Z" });
    const by = (key: string) => statuses.find((s) => s.key === key)!;
    check("clé présente + appel journalisé : connecté", by("openai").state === "connecté" && by("openai").lastSuccess === "2026-10-02T10:00:00Z");
    check("clé présente, jamais appelé", by("hunter").state === "jamais appelé");
    check("clé absente : « clé manquante », noms des variables, pas de bouton", by("pappers").state === "clé manquante" && by("pappers").missing[0] === "PAPPERS_API_KEY" && by("pappers").test === null);
    check("Resend (non utilisé par ORION) : « non utilisé »", by("resend").state === "non utilisé" && by("resend").test === null);
    check("n8n envoi / réception : jamais de bouton « Tester »", by("n8n_envoi").test === null && by("n8n_reception").test === null);
    check("BODACC (open data, sans clé) : testable", by("bodacc").missing.length === 0 && by("bodacc").test !== null);
    check("aucune valeur de clé ni d'URL secrète dans ce que reçoit l'écran", !JSON.stringify(statuses).includes(SECRET) && !JSON.stringify(statuses).includes("secret-path"));

    const calls: string[] = [];
    const fake = (status: number) =>
      (async (url: string) => (calls.push(String(url)), new Response('{"token":"x"}', { status }))) as unknown as typeof fetch;
    const ok = await testIntegration("openai", { fetchImpl: fake(200), env });
    check("Tester OpenAI : GET /v1/models (gratuit)", ok?.ok === true && calls.at(-1) === "https://api.openai.com/v1/models", calls);
    const refused = await testIntegration("hunter", { fetchImpl: fake(401), env });
    check("clé refusée : erreur lisible, sans la clé", refused?.ok === false && refused.detail.includes("401") && !refused.detail.includes(SECRET), refused);
    const before = calls.length;
    check("n8n : aucun test, aucun appel", (await testIntegration("n8n_envoi", { fetchImpl: fake(200), env })) === null && calls.length === before);
    check("BODACC : 1 annonce d'open data", (await testIntegration("bodacc", { fetchImpl: fake(200), env }))?.ok === true && calls.at(-1)!.includes("limit=1"));
    check("statuts HTTP traduits", describeHttp(429, "X").detail.includes("quota") && describeHttp(500, "X").ok === false);

    const db = new FakeDb({
      api_usage: [{ service: "openai", created_at: "2026-10-02T10:00:00Z" }, { service: "openai", created_at: "2026-10-03T08:00:00Z" }],
      free_api_calls: [{ service: "inpi", created_at: "2026-10-02T21:00:00Z" }],
      signal_candidates: [{ source: "france-travail", created_at: "2026-10-02T16:18:00Z" }],
      messages: [{ status: "sent", sent_at: "2026-10-01T07:00:08Z", gmail_message_id: "g" }],
      inbound_messages: [{ received_at: "2026-09-27T13:00:00Z" }],
      prospects: [{ id: "p" }],
    });
    const loaded = await loadIntegrations(db, { OPENAI_API_KEY: "k", INPI_USERNAME: "u", INPI_PASSWORD: "p", FRANCE_TRAVAIL_CLIENT_ID: "i", FRANCE_TRAVAIL_CLIENT_SECRET: "s", N8N_WEBHOOK_SEND_URL: "u" });
    const get = (key: string) => loaded.find((s) => s.key === key)!;
    check("dernier appel OpenAI = le plus récent des journaux", get("openai").lastSuccess === "2026-10-03T08:00:00Z", get("openai"));
    check("INPI, France Travail, envoi n8n : lus dans leurs journaux", get("inpi").state === "connecté" && get("france_travail").lastSuccess === "2026-10-02T16:18:00Z" && get("n8n_envoi").lastSuccess === "2026-10-01T07:00:08Z");
  }

  console.log("\n4. Délivrabilité : SPF, DKIM, DMARC");
  {
    check("SPF Google : ok", judgeSpf(["v=spf1 include:_spf.google.com ~all"]).verdict === "ok");
    check("SPF sans Google : attention", judgeSpf(["v=spf1 include:mailgun.org ~all"]).verdict === "attention");
    check("deux SPF : attention", judgeSpf(["v=spf1 -all", "v=spf1 include:_spf.google.com ~all"]).verdict === "attention");
    check("DKIM publié : ok ; révoqué : attention", judgeDkim(["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"]).verdict === "ok" && judgeDkim(["v=DKIM1; p="]).verdict === "attention");
    check("DMARC p=none : attention ; p=quarantine : ok", judgeDmarc(["v=DMARC1; p=none"]).verdict === "attention" && judgeDmarc(["v=DMARC1; p=quarantine; rua=mailto:x@y.fr"]).verdict === "ok");
    const records: Record<string, string[][]> = {
      "axelremillat.com": [["v=spf1 include:_spf.google.com ", "~all"]],
      "google._domainkey.axelremillat.com": [["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"]],
    };
    const resolver = async (host: string) => {
      if (records[host]) return records[host];
      throw Object.assign(new Error("not found"), { code: host.startsWith("_dmarc") ? "ENOTFOUND" : "ESERVFAIL" });
    };
    const checks = await checkDomain("axelremillat.com", resolver, "google");
    check("lecture DNS (faux résolveur) : SPF en plusieurs morceaux recollé", checks[0].verdict === "ok", checks[0]);
    check("DKIM sous « google._domainkey »", checks[1].host === "google._domainkey.axelremillat.com" && checks[1].verdict === "ok");
    check("DMARC introuvable : « absent » (pas une erreur)", checks[2].verdict === "absent");
  }

  console.log("\n5. Navigation et redirections");
  {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    check("une entrée Réglages ; plus de Stats ni de Coûts", hrefs.includes("/reglages") && !hrefs.includes("/stats") && !hrefs.includes("/couts"), hrefs);
    const config = readFileSync("next.config.mjs", "utf8");
    check("/stats → /reglages/donnees (permanent)", /source: "\/stats", destination: "\/reglages\/donnees", permanent: true/.test(config));
    check("/couts → /reglages/couts (permanent)", /source: "\/couts", destination: "\/reglages\/couts", permanent: true/.test(config));
  }


  console.log("\n6. Au-delà de 1 000 lignes (QA du 03/10 : PostgREST tronque en silence)");
  {
    const { readAll } = await import("../lib/supabase/read-all");
    const { loadPilotage } = await import("../lib/usage/pilotage");
    const rows = Array.from({ length: 2_500 }, (_, index) => ({
      id: `u${String(index).padStart(5, "0")}`, user_id: "u1", service: index % 2 ? "openai" : "linkup", operation: "x", units: 10, cost: 0.01,
      created_at: new Date(Date.UTC(2026, 9, 1 + (index % 3), 9, 0, index % 60)).toISOString(),
    }));
    const db = new FakeDb({ api_usage: rows, free_api_calls: [] });
    const all = await readAll(() => (db as never as { from: (t: string) => any }).from("api_usage").select("*").order("id"));
    check("lecture page par page : les 2 500 lignes, sans doublon", all.length === 2_500 && new Set(all.map((row: any) => row.id)).size === 2_500, all.length);
    for (const key of ["HUNTER_API_KEY", "PAPPERS_API_KEY"]) delete process.env[key];
    const pilotage = await loadPilotage(db, new Date("2026-10-03T12:00:00Z"));
    check("Cockpit : les 2 500 requêtes comptées (pas 1 000)", pilotage.consumption.window.calls.openai + pilotage.consumption.window.calls.linkup === 2_500, pilotage.consumption.window.calls);
    check("Cockpit : dépense d'octobre = 2 500 × 0,01 €", pilotage.consumption.month.eur === 25, pilotage.consumption.month.eur);
  }
  console.log(failures === 0 ? "\nTous les tests des Réglages passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
