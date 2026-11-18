// Accès à la comptabilité : réservé à Axel. Le middleware exige déjà une session ; ici, en plus, si COMPTA_EMAIL est
// défini, seul ce compte entre (404 pour tout autre). La RLS (owner_id = auth.uid()) cloisonne de toute façon les
// données par compte. Mode démo local (données fictives) : aucune session demandée.
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { modeDemo } from "./contexte";
import { compteAutorise } from "./regle-acces";

/** Garde des pages et des actions compta ; renvoie l'e-mail affiché. */
export async function gardeCompta(): Promise<string> {
  if (modeDemo()) return "démo (données fictives)";
  const user = await getUser();
  if (!user) redirect("/login?next=/compta");
  if (!compteAutorise(user.email, process.env.COMPTA_EMAIL)) notFound();
  return user.email ?? "compte";
}
