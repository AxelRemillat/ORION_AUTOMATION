/**
 * LE CONTACT NOMMÉ EST-IL LE TITULAIRE DE L'ADRESSE ? (Cowork #35) — code pur.
 *
 * RISO FRANCE : adresse f.taoufik@risofrance.fr, contact affiché « Toshihiko Kawatsu » (le
 * dirigeant) → le mail aurait salué M. Kawatsu dans la boîte de M. Taoufik. Un mot du nom
 * (≥ 4 lettres) dans la partie locale, ou un mot court égal à un segment (« xu.an »), suffit.
 * `null` : boîte de rôle (contact@, info@…) ou nom absent — rien à vérifier.
 */
const ROLE_BOX = /^(contact|contacts|info|infos|accueil|agence|reclamations?|commercial|secretariat|direction|admin|administration|bonjour|hello|office|sav|service|devis|compta|comptabilite|rh|recrutement)$/;

const plain = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").trim();

export function ownerMismatch(email: string | null | undefined, name: string | null | undefined): boolean | null {
  if (!email || !name) return null;
  const local = email.split("@")[0].toLowerCase();
  if (ROLE_BOX.test(local.split(/[._-]/)[0] ?? "")) return null;
  const words = plain(name).split(/\s+/).filter((word) => word.length >= 2 && !["mr", "mme", "m"].includes(word));
  if (!words.length) return null;
  const flat = plain(local).replace(/\s+/g, "");
  const segments = local.split(/[._-]/).map((part) => plain(part).replace(/\s+/g, ""));
  return !words.some((word) => (word.length >= 4 && flat.includes(word)) || segments.includes(word));
}
