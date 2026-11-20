// Règle pure de l'accès à la compta (testée sans Next) : sans COMPTA_EMAIL, tout compte connecté ; sinon ce compte seul.
/** Vrai si le compte connecté est celui de la compta (règle pure, testée). */
export function compteAutorise(email: string | null | undefined, attendu: string | undefined): boolean {
  if (!attendu?.trim()) return true;
  return !!email && email.trim().toLowerCase() === attendu.trim().toLowerCase();
}
