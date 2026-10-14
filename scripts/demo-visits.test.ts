/**
 * DÉMOS OUVERTES DEPUIS LES MAILS (Cowork #34) — ingestion, compteurs, encart.
 * Aucun réseau, aucune base réelle. `npm run test:demo-visits`
 */
import { readFileSync } from "node:fs";
import { buildDemoRows, demoLinksIn, normalizeDemo, parisDay, parseVisit } from "../lib/demo-visits/model";
import { recordDemoVisit } from "../lib/demo-visits/store";
import { demoVisitAuthorized } from "../lib/demo-visits/auth";
import { isMachinePath } from "../middleware";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const NOW = new Date("2026-10-14T15:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** Fausse base : la fonction SQL d'incrément, en mémoire. */
function fakeCounters() {
  const rows = new Map<string, number>();
  const calls: Record<string, unknown>[] = [];
  return {
    rows,
    calls,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      const key = `${args.p_day}|${args.p_demo}|${args.p_v}|${args.p_type}`;
      rows.set(key, (rows.get(key) ?? 0) + 1);
      return { error: null };
    },
    from: () => ({}),
  };
}

async function main() {
  console.log("\n1. Ingestion : secret exigé, corps validé, rien de personnel");
  {
    const request = (secret?: string) => new Request("https://orion.axelremillat.com/api/demo-visits", { method: "POST", headers: secret ? { "x-demo-visits-secret": secret } : {} });
    check("refusée sans en-tête", !demoVisitAuthorized(request(), "s3cret-partage"));
    check("refusée avec un mauvais secret", !demoVisitAuthorized(request("autre"), "s3cret-partage") && !demoVisitAuthorized(request("s3cret-partag"), "s3cret-partage"));
    check("refusée si ORION n'a pas de secret configuré, même avec un en-tête", !demoVisitAuthorized(request("x"), undefined) && !demoVisitAuthorized(request(""), ""));
    check("acceptée avec le bon secret", demoVisitAuthorized(request("s3cret-partage"), "s3cret-partage"));
    const route = readFileSync("app/api/demo-visits/route.ts", "utf8");
    check("la route renvoie 401 avant tout accès à la base", route.indexOf("demoVisitAuthorized(request)") < route.indexOf("createAdminClient()") && /status: 401/.test(route));
    check("route machine : pas de redirection vers /login", isMachinePath("/api/demo-visits"));
    check("visite valide", JSON.stringify(parseVisit({ demo: "email", v: "3", type: "arrivee" })) === JSON.stringify({ demo: "email", v: "3", type: "arrivee" }));
    const withExtras = parseVisit({ demo: "invoice", v: "2", type: "demo_start", email: "dirigeant@acme.fr", ip: "1.2.3.4", ua: "Mozilla", id: "p-42", date: "2020-01-01" });
    check("tout le reste est jeté (e-mail, IP, user-agent, identifiant, date du client)", JSON.stringify(withExtras) === JSON.stringify({ demo: "invoice", v: "2", type: "demo_start" }), withExtras);
    check("refusées : type inconnu, v non numérique, démo invalide", parseVisit({ demo: "email", v: "3", type: "achat" }) === null && parseVisit({ demo: "email", v: "abc", type: "arrivee" }) === null && parseVisit({ demo: "<script>", v: "1", type: "arrivee" }) === null && parseVisit(null) === null);
    check("agent devis : « agent-menuiserie » compte comme « agent »", normalizeDemo("agent-menuiserie") === "agent" && normalizeDemo("agent") === "agent");
    const migration = readFileSync(readdir("supabase/migrations").find((file) => file.endsWith("_demo_visits_daily.sql"))!, "utf8");
    const table = migration.slice(migration.indexOf("create table"), migration.indexOf(");", migration.indexOf("create table")));
    const columns = [...table.matchAll(/^\s{2}([a-z_]+) [a-z]/gm)].map((match) => match[1]).filter((name) => name !== "primary");
    check("table : uniquement jour, démo, v, type, compteur", JSON.stringify(columns) === JSON.stringify(["day", "demo", "v", "type", "count"]), columns);
  }

  console.log("\n2. Compteurs");
  {
    const db = fakeCounters();
    for (let i = 0; i < 3; i += 1) await recordDemoVisit(db, { demo: "email", v: "3", type: "arrivee" }, NOW);
    await recordDemoVisit(db, { demo: "email", v: "3", type: "demo_start" }, NOW);
    await recordDemoVisit(db, { demo: "email", v: "3", type: "arrivee" }, new Date("2026-10-14T22:30:00.000Z")); // 00 h 30 à Paris : le 15
    check("trois arrivées le même jour : un compteur à 3", db.rows.get("2026-10-14|email|3|arrivee") === 3, [...db.rows]);
    check("démo lancée comptée à part", db.rows.get("2026-10-14|email|3|demo_start") === 1);
    check("jour civil à Paris (22 h 30 UTC = le lendemain)", db.rows.get("2026-10-15|email|3|arrivee") === 1 && parisDay(new Date("2026-10-14T22:30:00Z")) === "2026-10-15");
    check("seuls jour, démo, v et type partent en base", db.calls.every((call) => Object.keys(call).sort().join() === "name,p_day,p_demo,p_type,p_v"));
  }

  console.log("\n3. Encart : mails envoyés / arrivées / démos lancées, 7 et 30 jours");
  {
    check("liens d'un mail", JSON.stringify(demoLinksIn("Exemple : https://axelremillat.com/automatisations?demo=email&v=3 et axelremillat.com/agent?v=2.")) === JSON.stringify([{ demo: "email", v: "3" }, { demo: "agent", v: "2" }]));
    check("lien sans v= : gardé, marqué « — »", demoLinksIn("axelremillat.com/automatisations?demo=invoice")[0]?.v === "—");
    const mail = (link: string, days: number) => ({ body: `Bonjour,\n\nExemple testable : https://axelremillat.com/${link}\n\nAxel`, sent_at: daysAgo(days).toISOString() });
    const rows = buildDemoRows({
      now: NOW,
      sent: [mail("automatisations?demo=email&v=3", 1), mail("automatisations?demo=email&v=3", 10), mail("agent?v=2", 2), mail("automatisations?demo=email&v=3", 45)],
      counters: [
        { day: parisDay(daysAgo(1)), demo: "email", v: "3", type: "arrivee", count: 2 },
        { day: parisDay(daysAgo(12)), demo: "email", v: "3", type: "arrivee", count: 1 },
        { day: parisDay(daysAgo(1)), demo: "email", v: "3", type: "demo_start", count: 1 },
        { day: parisDay(daysAgo(40)), demo: "email", v: "3", type: "arrivee", count: 9 },
        { day: parisDay(daysAgo(3)), demo: "agent", v: "2", type: "demo_result", count: 1 },
      ],
    });
    const email = rows.find((row) => row.demo === "email" && row.v === "3")!;
    const agent = rows.find((row) => row.demo === "agent" && row.v === "2")!;
    check("email v=3 : 1 / 2 mails, 2 / 3 arrivées, 1 / 1 démo lancée (hors fenêtre exclu)", email.sent.d7 === 1 && email.sent.d30 === 2 && email.arrivals.d7 === 2 && email.arrivals.d30 === 3 && email.starts.d7 === 1 && email.starts.d30 === 1, email);
    check("agent v=2 : 1 mail, 0 arrivée, 1 démo aboutie", agent.sent.d7 === 1 && agent.arrivals.d30 === 0 && agent.results.d7 === 1, agent);
    check("trié par mails envoyés", rows[0].demo === "email");
  }

  console.log(failures ? `\n${failures} test(s) en échec.` : "\nTous les tests des démos ouvertes passent.");
  if (failures) process.exit(1);
}

function readdir(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("node:fs").readdirSync(dir) as string[]).map((file) => `${dir}/${file}`);
}

void main();
