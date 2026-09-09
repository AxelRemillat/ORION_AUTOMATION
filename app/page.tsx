import { redirect } from "next/navigation";

/**
 * La racine n'a pas d'ecran propre : elle ouvre le Cockpit, l'accueil d'ORION.
 * Le middleware oriente vers /login si la session manque.
 */
export default function HomePage() {
  redirect("/cockpit");
}
