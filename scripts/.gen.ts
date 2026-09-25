import { existsSync, readFileSync } from "node:fs";
function loadEnv(f = ".env.local"): void {
  if (!existsSync(f)) return;
  for (const l of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();
const BASE = "https://orion.axelremillat.com";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const ref = new URL(url).hostname.split(".")[0];

async function signIn(): Promise<string> {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ORION_EMAIL, password: process.env.ORION_PASSWORD }),
  });
  if (!r.ok) throw new Error(`connexion refusee : HTTP ${r.status}`);
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(await r.json()), "utf8").toString("base64")}`;
}

(async () => {
  const cookie = await signIn();
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE as string, { auth: { persistSession: false } });

  const names = (process.env.TARGETS ?? "SELECTION HABITAT,TERDICI").split(",");
  const before = (await db.from("api_usage").select("cost")).data ?? [];
  const spentBefore = before.reduce((t, r) => t + Number(r.cost ?? 0), 0);

  for (const name of names) {
    const { data: p } = await db.from("prospects").select("id, company_name, sector, city")
      .ilike("company_name", `%${name.trim()}%`).is("deleted_at", null).limit(1).maybeSingle();
    if (!p) { console.log(`\n=== ${name} : introuvable en base ===`); continue; }

    console.log(`\n${"=".repeat(70)}\n${p.company_name} — ${p.sector ?? "?"} · ${p.city ?? "?"}\n${"=".repeat(70)}`);
    const started = Date.now();
    const res = await fetch(`${BASE}/api/emails/generate`, {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ prospectId: p.id, tone: "direct", mode: "full" }),
    });
    const text = await res.text();
    if (!res.ok) { console.log(`HTTP ${res.status} :`, text.slice(0, 300)); continue; }
    const d = JSON.parse(text) as {
      email?: { subject: string; body: string };
      brief?: { proofId?: string | null; angle?: { type: string; insight: string } };
      critique?: Record<string, { score: number; note: string }>;
      needsReview?: boolean; reviewReasons?: string[];
    };
    const body = d.email?.body ?? "";
    const sigIndex = body.lastIndexOf("Axel Remillat");
    const corps = sigIndex > 0 ? body.slice(0, sigIndex).trim() : body;
    console.log(`HTTP ${res.status} en ${Math.round((Date.now() - started) / 1000)} s · ${corps.split(/\s+/).filter(Boolean).length} mots hors signature`);
    console.log(`angle : ${d.brief?.angle?.type} — ${d.brief?.angle?.insight}`);
    console.log(`\nObjet : ${d.email?.subject}\n`);
    console.log(body);
    console.log("\nnotes du juge :");
    for (const [k, v] of Object.entries(d.critique ?? {})) console.log(`  ${k.padEnd(20)} ${v.score}/5 — ${v.note.slice(0, 90)}`);
    console.log(`a revoir : ${d.needsReview} ${(d.reviewReasons ?? []).join(" | ")}`);
  }

  const after = (await db.from("api_usage").select("cost")).data ?? [];
  const spent = after.reduce((t, r) => t + Number(r.cost ?? 0), 0) - spentBefore;
  console.log(`\ncout total : ${spent.toFixed(4)} EUR · par mail : ${(spent / names.length).toFixed(4)} EUR`);
})().catch((e) => { console.error("ECHEC :", e.message); process.exit(1); });
