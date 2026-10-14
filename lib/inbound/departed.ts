/**
 * CONTACT PARTI (Cowork #54, 14/10/2026). Réponse automatique « je ne travaille
 * plus chez … », avec les personnes à contacter à la place : classée
 * « Absence », elle laissait croire que les relances pouvaient continuer — vers
 * une boîte morte. Distinct de l'absence : l'adresse ne servira plus.
 *
 * Pur : détection (FR + EN), contacts proposés (même domaine uniquement) et
 * choix suggéré (opérations / logistique avant commercial pour nos familles).
 */

const DEPARTED = [
  String.raw`(?:i am|i'm|he is|she is|is) no longer (?:working|employed|with|at|part of)`,
  String.raw`no longer (?:works?|working|employed) (?:at|for|with)`,
  String.raw`(?:has|have|i've|i have) left (?:the company|the organi[sz]ation|[A-Z])`,
  String.raw`left the company`,
  String.raw`(?:ne|n['’]) ?(?:travaille|travaillons|fait|fais|fera|suis|est) plus (?:chez|pour|au sein|dans (?:la soci[ée]t[ée]|l['’]entreprise)|partie (?:de|du|des)|en poste|en fonction|salari[ée])`,
  String.raw`(?:a|ai|avons) quitt[ée]e? (?:la soci[ée]t[ée]|l['’]entreprise|ses fonctions|mes fonctions|le groupe|[A-Z])`,
  String.raw`cette (?:adresse|bo[iî]te)(?: (?:e-?mail|mail|aux lettres))? (?:n['’]est plus|ne sera plus) (?:active|utilis[ée]e|consult[ée]e|valide|lue)`,
  String.raw`(?:this )?mailbox is no longer (?:monitored|active|in use)`,
].join("|");
const DEPARTED_RE = new RegExp(DEPARTED, "i");
/** La mention vient tôt dans le message ; au-delà, c'est une vraie réponse qui en parle. */
const DEPARTED_LEAD = 600;

export function isDeparted(message: { body?: string | null; subject?: string | null }): boolean {
  const body = (message.body ?? "").replace(/\s+/g, " ");
  return body.length <= 3000 && DEPARTED_RE.test(body.slice(0, DEPARTED_LEAD));
}

export interface ProposedContact {
  email: string;
  name: string | null;
  role: string | null;
  /** Famille de la demande : opérations / logistique, commercial, autre. */
  family: "operations" | "commercial" | "autre";
  suggested: boolean;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OPERATIONS = /produit|product|commande|order|logisti|livraison|deliver|exp[ée]dition|shipping|exploitation|op[ée]ration|achat|purchas|approvision|supply|adv|administration des ventes|stock|factur|invoic|comptab|account/i;
const COMMERCIAL = /commercial|sales|vente|business|devis|quot/i;

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** Le nom cité juste avant l'adresse : « … contact Jeanne Dupont at jd@… », « … auprès de M. Paul Martin (pm@…) ». */
function nameBefore(text: string): string | null {
  const match = /(?:contact(?:er|ez)?|joindre|auprès de|à|to|reach)\s+(?:(?:M\.|Mme|Mr\.?|Mrs\.?|Ms\.?)\s+)?((?:[A-ZÀ-Ý][\p{L}'’-]+[\s.]+){1,3}[A-ZÀ-Ý][\p{L}'’-]+)\s*(?:at|à l['’]adresse|:|\(|,|-|–|<|$)\s*$/u.exec(text);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

/** Le rôle annoncé dans la phrase : « For any inquiries regarding products, orders… », « Pour toute question commerciale… ». */
function roleIn(sentence: string): string | null {
  const match = /(?:regarding|concerning|about|related to|for|pour|concernant|relatives? (?:à|aux)|au sujet (?:de|des))\s+(?:any |all |toute?s? (?:les )?|les |vos )?(?:inquiries|questions?|demandes?|requests?)?\s*(?:regarding|concerning|about|related to|concernant|relatives? (?:à|aux)|sur|de)?\s*([^.;:]{3,80}?),?\s+(?:please|merci|veuillez|contactez|vous pouvez|n['’]h[ée]sitez)/i.exec(sentence);
  return match ? match[1].replace(/^(?:inquiries|questions?|demandes?)\s+/i, "").trim() : null;
}

/** Contacts cités dans la réponse, du MÊME domaine que le prospect ; l'expéditeur parti exclu. */
export function proposedContacts(body: string, input: { domain: string | null; departedEmail: string }): ProposedContact[] {
  const domain = (input.domain ?? domainOf(input.departedEmail)).toLowerCase();
  const sentences = body.replace(/\r/g, "").split(/(?<=[.!?])\s+|\n+/);
  const seen = new Set<string>([input.departedEmail.toLowerCase()]);
  const out: ProposedContact[] = [];
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(EMAIL_RE)) {
      const email = match[0].toLowerCase().replace(/\.$/, "");
      if (seen.has(email) || domainOf(email) !== domain) continue;
      seen.add(email);
      const role = roleIn(sentence);
      const family = role && OPERATIONS.test(role) ? "operations" : role && COMMERCIAL.test(role) ? "commercial" : "autre";
      out.push({ email, name: nameBefore(sentence.slice(0, match.index)), role, family, suggested: false });
    }
  }
  // Choix suggéré : opérations / logistique, puis commercial, puis le premier cité.
  const pick = out.find((item) => item.family === "operations") ?? out.find((item) => item.family === "commercial") ?? out[0];
  if (pick) pick.suggested = true;
  return out;
}
