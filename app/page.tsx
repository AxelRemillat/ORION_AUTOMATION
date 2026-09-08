import { redirect } from "next/navigation";

/** La racine n'a pas d'écran propre : le middleware oriente vers /login si besoin. */
export default function HomePage() {
  redirect("/recherche");
}
