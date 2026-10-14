/**
 * DÉMOS OUVERTES DEPUIS LES MAILS (Cowork #34) — règles pures.
 *
 * Le portfolio signale trois choses, côté serveur, quand une page arrive avec
 * `v=` (lien d'un mail ORION) : l'arrivée, la démo lancée, la démo aboutie.
 * ORION n'en garde que des COMPTEURS par jour × démo × v × type. Aucun
 * identifiant, aucune IP, aucun user-agent, aucune donnée personnelle.
 */
export const VISIT_TYPES = ["arrivee", "demo_start", "demo_result"] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export interface DemoVisit {
  demo: string;
  v: string;
  type: VisitType;
}

/** Variable partagée avec le portfolio (même nom dans les deux projets Vercel). */
export const DEMO_VISITS_SECRET_ENV = "DEMO_VISITS_SECRET";
export const DEMO_VISITS_HEADER = "x-demo-visits-secret";

/** Démo normalisée : l'agent devis (« agent », « agent-menuiserie »…) compte comme « agent ». */
export function normalizeDemo(raw: unknown): string | null {
  const demo = String(raw ?? "").trim().toLowerCase();
  if (/^agent(-[a-z0-9-]+)?$/.test(demo)) return "agent";
  return /^[a-z][a-z0-9-]{0,31}$/.test(demo) ? demo : null;
}

/** Corps reçu → visite valide, sinon `null`. Toute autre clé (date, identifiant…) est ignorée. */
export function parseVisit(body: unknown): DemoVisit | null {
  const raw = (body ?? {}) as Record<string, unknown>;
  const demo = normalizeDemo(raw.demo);
  const v = String(raw.v ?? "").trim();
  const type = String(raw.type ?? "") as VisitType;
  if (!demo || !/^[0-9]{1,2}$/.test(v) || !VISIT_TYPES.includes(type)) return null;
  return { demo, v, type };
}

/** Jour civil à Paris (AAAA-MM-JJ) : la date vient du serveur ORION, jamais du client. */
export const parisDay = (date: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(date);

/** Liens de démo d'un mail : `/automatisations?demo=email&v=3` → { demo: "email", v: "3" } ; `/agent?v=2` → agent. */
export function demoLinksIn(body: string): { demo: string; v: string }[] {
  const out = new Map<string, { demo: string; v: string }>();
  for (const match of body.matchAll(/axelremillat\.com\/(automatisations|agent)(\?[^\s)>\]"']*)?/gi)) {
    // Ponctuation de fin de phrase collée au lien (« …?v=2. ») : hors de l'URL.
    const query = new URLSearchParams((match[2] ?? "").slice(1).replace(/[.,;:!?]+$/, ""));
    const demo = match[1].toLowerCase() === "agent" ? "agent" : normalizeDemo(query.get("demo"));
    if (!demo) continue;
    const v = query.get("v")?.trim() || "—";
    out.set(`${demo}|${v}`, { demo, v });
  }
  return [...out.values()];
}

export interface DemoRow {
  demo: string;
  v: string;
  sent: { d7: number; d30: number };
  arrivals: { d7: number; d30: number };
  starts: { d7: number; d30: number };
  results: { d7: number; d30: number };
}

const zero = () => ({ d7: 0, d30: 0 });

/**
 * Une ligne par lien (démo × v) : mails envoyés qui le portent, arrivées,
 * démos lancées et abouties, sur 7 et 30 jours (jours civils à Paris).
 */
export function buildDemoRows(input: {
  sent: { body: string; sent_at: string }[];
  counters: { day: string; demo: string; v: string; type: string; count: number }[];
  now: Date;
}): DemoRow[] {
  const today = parisDay(input.now);
  const since = (days: number) => parisDay(new Date(input.now.getTime() - (days - 1) * 86_400_000));
  const d7 = since(7);
  const d30 = since(30);
  const rows = new Map<string, DemoRow>();
  const row = (demo: string, v: string) => {
    const key = `${demo}|${v}`;
    if (!rows.has(key)) rows.set(key, { demo, v, sent: zero(), arrivals: zero(), starts: zero(), results: zero() });
    return rows.get(key)!;
  };
  const add = (bucket: { d7: number; d30: number }, day: string, count: number) => {
    if (day < d30 || day > today) return;
    bucket.d30 += count;
    if (day >= d7) bucket.d7 += count;
  };
  for (const message of input.sent) {
    const day = parisDay(new Date(message.sent_at));
    for (const link of demoLinksIn(message.body)) add(row(link.demo, link.v).sent, day, 1);
  }
  for (const counter of input.counters) {
    const target = row(counter.demo, counter.v);
    const bucket = counter.type === "arrivee" ? target.arrivals : counter.type === "demo_start" ? target.starts : counter.type === "demo_result" ? target.results : null;
    if (bucket) add(bucket, counter.day, counter.count);
  }
  return [...rows.values()]
    .filter((item) => item.sent.d30 || item.arrivals.d30 || item.starts.d30)
    .sort((a, b) => b.sent.d30 - a.sent.d30 || a.demo.localeCompare(b.demo) || a.v.localeCompare(b.v));
}
