import type { Platform } from "../types";
import type { EmailKind } from "./parse";

/** E-mail de plateforme tel que la page Opportunités l'affiche (suivi d'une fiche, « à trier »). */
export interface OpportunityEmail {
  id: string;
  platform: Platform | null;
  kind: EmailKind;
  subject: string | null;
  from_address: string | null;
  received_at: string | null;
  status: "a_trier" | "cree" | "rattache" | "trie";
  opportunity_id: string | null;
  excerpt: string | null;
}

/** E-mails encore à trier, des plus récents aux plus anciens. */
export const emailsToSort = (emails: readonly OpportunityEmail[]) => emails.filter((email) => email.status === "a_trier");

/** Suivi d'une fiche : ses e-mails, du plus récent au plus ancien. */
export const emailsOf = (emails: readonly OpportunityEmail[], opportunityId: string) => emails.filter((email) => email.opportunity_id === opportunityId);

/** Montant suggéré à saisir sur la plateforme : « 450 € », « $550 », « $40/hr ». */
export function suggestedPrice(amount: number | null | undefined, currency: string | null | undefined, hourly: boolean | undefined): string {
  if (amount == null) return "—";
  if (currency === "USD") return `$${amount.toLocaleString("en-US")}${hourly ? "/hr" : ""}`;
  return `${amount.toLocaleString("fr-FR")} €${hourly ? "/h" : ""}`;
}
