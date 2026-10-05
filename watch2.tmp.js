const { db } = require("./.test-build/scripts/quality-live");
const JOB = "b9fd8d77-1269-4b6a-835e-6413c6ad474e", SINCE = "2026-10-05T00:05:00Z";
(async () => {
  let last = "";
  const deadline = Date.now() + 560_000;
  while (Date.now() < deadline) {
    const { data: j } = await db.from("jobs").select("status, step, progress, error").eq("id", JOB).single();
    const { data: u } = await db.from("api_usage").select("cost").gte("created_at", SINCE);
    const eur = (u || []).reduce((t, r) => t + (Number(r.cost) || 0), 0);
    const line = `${j.status} | étape ${j.step} | ${j.progress?.pct ?? 0} % | ${j.progress?.step ?? ""} | ${eur.toFixed(3)} €${j.error ? " | ERREUR " + j.error : ""}`;
    if (line !== last) { console.log(new Date().toISOString().slice(11, 19), line); last = line; }
    if (eur > 1.4 && !["done", "failed", "cancelled"].includes(j.status)) {
      await db.from("jobs").update({ status: "cancelled" }).eq("id", JOB);
      console.log("ARRÊT : plafond de coût du run approché");
      break;
    }
    if (["done", "failed", "cancelled"].includes(j.status)) break;
    await new Promise((r) => setTimeout(r, 20_000));
  }
})();
