/**
 * Upwork : découpage des alertes, règle de lancement, refus (Cowork #18).
 *
 * Les quatre e-mails Upwork réellement ingérés au 11/10 sont tous
 * transactionnels (Freelancer Plus, paiement, carte, vérification d'adresse) :
 * aucune alerte d'offre n'est encore arrivée, Axel venant de s'inscrire. La
 * fixture ci-dessous est donc RECONSTITUÉE d'après la structure d'un e-mail
 * d'alerte Upwork — titre en lien `/jobs/~id`, budget sur la ligne suivante,
 * extrait en dessous — et marquée comme telle.
 */
import { recommendedJobs } from "../lib/opportunities/email/parse";
import { decideEmail, statusAfterEvent } from "../lib/opportunities/email/ingest-email";
import { parsePlatformEmail } from "../lib/opportunities/email/parse";
import {
  readUpworkBudget,
  upworkIgnoreReason,
  upworkLaunchPrice,
  upworkLaunchVerdict,
  upworkTopics,
} from "../lib/opportunities/upwork-launch";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = new Date("2026-10-12T09:00:00Z");

/** FIXTURE RECONSTITUÉE : alerte « 4 new jobs matching your profile ». */
const ALERT_TEXT = `Hi Axel, here are new jobs matching your profile.

n8n workflow to sync Stripe payments to Google Sheets
https://www.upwork.com/jobs/~021899001122334455
Fixed-price - Intermediate - Est. budget: $350
We need an n8n workflow that pushes every new Stripe payment into a Google Sheet, with retry on failure.

AI chatbot for our customer support (RAG over our docs)
https://www.upwork.com/jobs/~021899001122334466
Hourly: $25.00-$45.00
Build a conversational AI assistant that answers from our documentation and escalates to a human.

Senior full-stack platform rebuild
https://www.upwork.com/jobs/~021899001122334477
Fixed-price - Expert - Est. budget: $8,000
Rebuild our marketplace platform from scratch, React and Node, 4 months.

Scrape LinkedIn profiles into a CSV
https://www.upwork.com/jobs/~021899001122334488
Fixed-price - Est. budget: $200
We want a bot to scrape LinkedIn profiles of recruiters and export them to CSV.

Logo design for a small bakery
https://www.upwork.com/jobs/~021899001122334499
Fixed-price - Est. budget: $25
Need a logo, quick unpaid test first to see your style.
`;

console.log("\n1. Découpage d'une alerte multi-offres");
{
  const jobs = recommendedJobs({ text: ALERT_TEXT, html: "" }, ALERT_TEXT);
  check("cinq offres distinctes", jobs.length === 5, String(jobs.length));
  check(
    "chaque offre porte son identifiant ~0…",
    jobs.every((job) => /^~0\d{15,}$/.test(job.externalId ?? "")),
    jobs.map((job) => job.externalId).join(" "),
  );
  check("le titre vient de la ligne au-dessus du lien", jobs[0]?.title.startsWith("n8n workflow to sync Stripe"), String(jobs[0]?.title));
  check("le budget est lu", (jobs[0]?.budget ?? "").includes("350"), String(jobs[0]?.budget));
  check("l'extrait suit le lien", (jobs[0]?.snippet ?? "").includes("Google Sheet"), String(jobs[0]?.snippet).slice(0, 60));

  // Dédoublonnage : le même lien deux fois ne fait qu'une offre.
  const doubled = recommendedJobs({ text: `${ALERT_TEXT}\n${ALERT_TEXT}`, html: "" }, `${ALERT_TEXT}\n${ALERT_TEXT}`);
  check("un lien répété ne crée pas de doublon", doubled.length === 5, String(doubled.length));
}

console.log("\n2. Lecture du budget");
{
  check("prix fixe", readUpworkBudget("Fixed-price - Est. budget: $350").kind === "fixed");
  check("montant du prix fixe", readUpworkBudget("Fixed-price - Est. budget: $350").usd === 350);
  check("fourchette fixe : la borne haute est le budget", readUpworkBudget("Est. budget: $300-$500").usd === 500);
  check("horaire reconnu", readUpworkBudget("Hourly: $25.00-$45.00").kind === "hourly");
  check("fourchette horaire : la borne basse", readUpworkBudget("Hourly: $25.00-$45.00").usd === 25);
  /*
   * Le separateur de MILLIERS, trouve par ce test : « $8,000 » se lisait
   * 8 dollars, donc une offre a 8 000 $ repartait en « moins de 30 $ ».
   */
  check("separateur de milliers", readUpworkBudget("Est. budget: $8,000").usd === 8000, String(readUpworkBudget("Est. budget: $8,000").usd));
  check("milliers ET decimales", readUpworkBudget("$1,500.00").usd === 1500, String(readUpworkBudget("$1,500.00").usd));
  check("point en separateur de milliers", readUpworkBudget("$8.000").usd === 8000, String(readUpworkBudget("$8.000").usd));
  check("millions", readUpworkBudget("$2,000,000").usd === 2000000, String(readUpworkBudget("$2,000,000").usd));
  check("taux decimal", readUpworkBudget("$12.50/hr").usd === 12.5, String(readUpworkBudget("$12.50/hr").usd));
  check("budget absent", readUpworkBudget(null).kind === "inconnu");
}

console.log("\n3. Règle « Lancement Upwork »");
{
  const jobs = recommendedJobs({ text: ALERT_TEXT, html: "" }, ALERT_TEXT);
  const verdict = (index: number, published = "2026-10-12T07:00:00Z") =>
    upworkLaunchVerdict(
      { title: jobs[index].title, description: jobs[index].snippet, budgetText: jobs[index].budget, publishedAt: published },
      NOW,
    );

  check("n8n à 350 $ publiée il y a 2 h : ALERTE", verdict(0).alert, verdict(0).reason);
  check("le motif nomme le sujet reconnu", verdict(0).reason.includes("n8n"), verdict(0).reason);
  check("chatbot en horaire : ALERTE", verdict(1).alert, verdict(1).reason);
  check("plateforme full-stack à 8 000 $ : à voir, pas d'alerte", !verdict(2).alert, verdict(2).reason);
  // Le sujet est verifie AVANT le budget : une plateforme full-stack est hors
  // metier, on ne va donc jamais jusqu au montant. Le motif le dit.
  check("et le motif dit qu elle est hors metier", verdict(2).reason.includes("hors du métier"), verdict(2).reason);
  check(
    "dans le metier mais a 2 000 $ : a voir, et le motif nomme le budget",
    (() => {
      const over = upworkLaunchVerdict({ title: "n8n automation platform", description: "Build a large n8n automation suite.", budgetText: "Est. budget: $2,000", publishedAt: "2026-10-12T08:00:00Z" }, NOW);
      return !over.alert && over.reason.includes("au-dessus de 500");
    })(),
    upworkLaunchVerdict({ title: "n8n automation platform", budgetText: "Est. budget: $2,000", publishedAt: "2026-10-12T08:00:00Z" }, NOW).reason,
  );

  check(
    "une offre dans le métier mais vieille de 30 h : pas d'alerte",
    !verdict(0, "2026-10-11T03:00:00Z").alert,
    verdict(0, "2026-10-11T03:00:00Z").reason,
  );
  check(
    "et le motif donne l'âge",
    /publiée il y a \d+ h/.test(verdict(0, "2026-10-11T03:00:00Z").reason),
    verdict(0, "2026-10-11T03:00:00Z").reason,
  );
  check(
    "hors métier : pas d'alerte, motif explicite",
    !upworkLaunchVerdict({ title: "Logo design for a bakery", budgetText: "$300", publishedAt: "2026-10-12T08:00:00Z" }, NOW).alert,
  );
  check(
    "date de publication inconnue : on n'alerte pas plutôt que de supposer",
    upworkLaunchVerdict({ title: "n8n automation", budgetText: "$300" }, NOW).reason === "date de publication inconnue",
  );
}

console.log("\n4. Refus fermes");
{
  const jobs = recommendedJobs({ text: ALERT_TEXT, html: "" }, ALERT_TEXT);
  const scrape = jobs.find((job) => /scrape linkedin/i.test(job.title));
  check(
    "scraping de LinkedIn : refusé",
    (upworkIgnoreReason({ title: scrape?.title ?? "", description: scrape?.snippet, budgetText: scrape?.budget }) ?? "").includes("conditions"),
    String(upworkIgnoreReason({ title: scrape?.title ?? "", description: scrape?.snippet, budgetText: scrape?.budget })),
  );
  check(
    "test non rémunéré : refusé",
    (upworkIgnoreReason({ title: "Logo design", description: "quick unpaid test first", budgetText: "$300" }) ?? "").includes("non rémunéré"),
  );
  check("contenu adulte : refusé", Boolean(upworkIgnoreReason({ title: "Automate posting for an adult website", budgetText: "$400" })));
  check("budget de 25 $ : refusé", (upworkIgnoreReason({ title: "n8n automation", budgetText: "$25" }) ?? "").includes("moins de 30"));
  check("taux de 12 $/h : refusé", (upworkIgnoreReason({ title: "n8n automation", budgetText: "Hourly: $12.00" }) ?? "").includes("moins de 20"));
  check("une offre normale n'est pas refusée", upworkIgnoreReason({ title: "n8n workflow", budgetText: "$350" }) === null);
  check(
    "un refus l'emporte sur le sujet reconnu",
    !upworkLaunchVerdict({ title: "n8n bot to scrape LinkedIn profiles", budgetText: "$300", publishedAt: "2026-10-12T08:00:00Z" }, NOW).alert,
  );
}

console.log("\n5. Prix de lancement");
{
  check("350 $ affichés → 290 $ (17,5 % sous le budget)", upworkLaunchPrice("Est. budget: $350").usd === 290, String(upworkLaunchPrice("Est. budget: $350").usd));
  check("le prix reste sous le budget affiché", (upworkLaunchPrice("$500").usd ?? 0) < 500);
  check("plancher à 100 $", upworkLaunchPrice("$100").usd === 100, String(upworkLaunchPrice("$100").usd));
  check("un petit budget ne descend pas sous le plancher", upworkLaunchPrice("$60").usd === 100, String(upworkLaunchPrice("$60").usd));
  check("horaire : 25 $/h", upworkLaunchPrice("Hourly: $25.00-$45.00").kind === "hourly" && upworkLaunchPrice("Hourly: $25.00-$45.00").usd === 25);
  check("budget inconnu : aucun prix inventé", upworkLaunchPrice(null).usd === null);
}

console.log("\n6. Sujets reconnus");
{
  check("n8n", upworkTopics({ title: "Build an n8n workflow" }).includes("n8n"));
  check("intégration d'API", upworkTopics({ title: "Integrate the Stripe REST API with our CRM" }).includes("intégration d'API"));
  check("agent IA", upworkTopics({ title: "Build an AI agent for lead qualification" }).includes("agent IA"));
  check("chatbot et RAG", upworkTopics({ title: "RAG chatbot over our docs" }).includes("chatbot"));
  check("un logo n'est pas du métier", upworkTopics({ title: "Logo design for a bakery" }).length === 0);
}

console.log("\n7. Invitations, messages, offres et contrats");
{
  /*
   * Le rattachement se fait par l IDENTIFIANT d offre, jamais par le titre :
   * deux clients peuvent publier « n8n automation needed » le meme jour.
   */
  const parsed = (over: Record<string, unknown> = {}) =>
    ({ platform: "upwork", kind: "invitation", title: "n8n workflow", url: "https://www.upwork.com/jobs/~021899001122334455", externalId: "~021899001122334455", clientName: null, budget: "$400", amountEur: null, body: "", jobs: [], ...over }) as never;

  const known = { id: "fiche-1", status: "envoyee" as const, external_id: "~021899001122334455" };

  const invitation = decideEmail(parsed(), known);
  check("invitation sur une fiche connue : evenement prioritaire rattache a la fiche (Cowork #68)", invitation.action === "evenement" && "opportunityId" in invitation && invitation.opportunityId !== null, invitation.action);
  check("et elle alerte (evenement : alerte urgente a l ingestion)", invitation.action === "evenement");

  const message = decideEmail(parsed({ kind: "message" }), known);
  check("message sur une fiche connue : evenement et statut Reponse", message.action === "evenement" && message.status === "reponse", JSON.stringify(message));

  // Upwork : un message sans fiche connue est la reponse a une proposition
  // envoyee hors ORION. On cree la fiche en « Reponse » plutot que de la perdre.
  const inconnu = decideEmail(parsed({ kind: "message" }), null);
  check("message Upwork inconnu : evenement, AUCUNE fiche creee (Cowork #68)", inconnu.action === "evenement" && inconnu.opportunityId === null, JSON.stringify(inconnu));

  const offre = decideEmail(parsed({ kind: "offre" }), known);
  check("offre de contrat : evenement, statut Conversation", offre.action === "evenement" && offre.status === "entretien", JSON.stringify(offre));

  const gagnee = decideEmail(parsed({ kind: "gagnee" }), { ...known, status: "entretien" });
  check("« Contract started » sur une fiche connue : Gagnee", gagnee.action === "rattache" && "status" in gagnee && gagnee.status === "gagnee", JSON.stringify(gagnee));
  check("le statut est marque comme change", "statusChanged" in gagnee && gagnee.statusChanged === true);

  // Sans fiche, rien a faire avancer : on ne fabrique pas une mission gagnee
  // dont on n a jamais vu l offre.
  const orpheline = decideEmail(parsed({ kind: "gagnee" }), null);
  check("« Contract started » sans fiche : a trier, motif explicite", orpheline.action === "a_trier" && "reason" in orpheline && orpheline.reason.includes("rien") === false && orpheline.reason.length > 0, JSON.stringify(orpheline));

  check("un contrat fait toujours avancer vers Gagnee", statusAfterEvent("envoyee", "gagnee") === "gagnee");
  check("une fiche deja gagnee ne rebouge pas", statusAfterEvent("gagnee", "gagnee") === null);
  check("une cloture apres un contrat ne le perd pas", statusAfterEvent("gagnee", "perdue") === null);
}

console.log("\n8. Sujets Upwork reels");
{
  const email = (subject: string) =>
    parsePlatformEmail({
      message_id: "m1",
      from: '"Upwork" <donotreply@upwork.com>',
      subject,
      text: "https://www.upwork.com/jobs/~021899001122334455",
      html: "",
      received_at: "2026-10-12T09:00:00.000Z",
    } as never);

  check("« Contract started » est un contrat", email("Your contract with Acme Corp has started").kind === "gagnee", email("Your contract with Acme Corp has started").kind);
  check("« sent you a message » est un message", email("John sent you a message").kind === "message", email("John sent you a message").kind);
  check("« invited you to apply » est une invitation", email("You've been invited to apply to a job").kind === "invitation", email("You've been invited to apply to a job").kind);
  check("« sent you an offer » est une offre", email("Acme sent you an offer").kind === "offre", email("Acme sent you an offer").kind);
  check("« new jobs matching your profile » est une recommandation", email("5 new jobs matching your profile").kind === "recommandation", email("5 new jobs matching your profile").kind);
  check("« proposal was declined » est une perte", email("Your proposal was declined").kind === "perdue", email("Your proposal was declined").kind);
  check("l identifiant d offre est lu dans le lien", email("John sent you a message").externalId === "~021899001122334455", String(email("John sent you a message").externalId));
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
