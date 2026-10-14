/**
 * SIMULATION DE L'ÉTAPE E-MAIL, GRATUITE (Cowork #34) — LECTURE SEULE : la vraie recherche de
 * contact (`runContactSearch`), sites lus en direct, mais ni Hunter, ni Linkup, ni modèle, et
 * rien n'est écrit (la prochaine préparation reprendra ces fiches).
 *
 *   … contact-gratuit.js "BARTHOUIL" "SARL DOS SANTOS - BARROSO (S ET B)"
 */
import { db, ownerId } from "./quality-live";
import { fetchHtml } from "@/lib/contact-finder/clients";
import { runContactSearch } from "@/lib/contact-finder/finder";
import type { ContactDeps } from "@/lib/contact-finder/finder";

const FREE: ContactDeps = {
  fetchHtml,
  webSearch: async () => null,
  hunterDomainSearch: async () => null,
  hunterFinder: async () => null,
  hunterVerify: async () => null,
};

async function main() {
  const userId = await ownerId();
  const table = db as never as { from: (t: string) => any };
  for (const name of process.argv.slice(2).filter((arg) => !arg.startsWith("--"))) {
    const { data } = await table.from("prospects").select("id, company_name, siren, city, website, email").eq("user_id", userId).eq("company_name", name).limit(1).maybeSingle();
    if (!data) {
      console.log(`· ${name} : fiche introuvable`);
      continue;
    }
    const { result, trace } = await runContactSearch(
      { prospectId: data.id, legalName: data.company_name, tradeNames: [], siren: data.siren, city: data.city, postalCode: null, leader: null, activity: null, knownWebsite: data.website, pappersWebsite: null, knownEmail: null },
      FREE,
      { linkup: 0, pages: 4, llm: 0, hunterDomainSearch: 0, hunterFinder: 0, hunterVerifier: 0 },
      { hunter: { allowed: false, reason: "simulation gratuite" } },
    );
    if (process.argv.includes("--trace")) console.log(JSON.stringify(trace).slice(0, 2000));
    console.log(`· ${data.company_name} | site ${result.website ?? "—"} | en base : ${data.email ?? "aucun e-mail"} → trouvé : ${result.email ?? "rien"}${result.email ? ` (site prouvé ${trace.candidates.find((item) => item.validated)?.domain ?? "?"}${result.doubtful ? ", hors domaine : À VÉRIFIER" : ""})` : ""}`);
  }
  process.exit(0);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
