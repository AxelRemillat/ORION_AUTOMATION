import { signalMeta, type SignalTone } from "@/lib/scoring";

/**
 * Puce de signal. La couleur porte du SENS, séparée de la couleur de marque :
 * ambre = signal chaud (intention immédiate), bleu = contexte favorable,
 * gris = information de fond.
 *
 * Le texte utilise les encres `*-ink` du design system : les couleurs
 * sémantiques brutes plafonnent à ~3:1 sur fond clair et ne passent pas AA.
 * Les opacités restent des multiples de 5 (Tailwind v3 n'en génère pas d'autres).
 */
const TONE_CLASS: Record<SignalTone, string> = {
  hot: "border-warn/25 bg-warn/10 text-warn-ink",
  warm: "border-primary/25 bg-primary/10 text-primary-ink",
  cool: "border-line text-muted",
};

const BASE =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4";

export function SignalChip({
  type,
  title,
  strength,
}: {
  type: string | undefined;
  title?: string;
  /**
   * Force commerciale : « fort » = fait engageant et daté (nouveau dirigeant,
   * mouvement de capital, offre publiée) ; « faible » = vrai mais sans portée,
   * ou source et datation incertaines.
   */
  strength?: "fort" | "moyen" | "faible";
}) {
  const meta = signalMeta(type);
  // Un signal faible garde sa couleur de type mais se declare : il ne doit ni
  // disparaitre, ni se faire passer pour une actualite datee. Un signal fort
  // ne porte PAS de mention : c'est le cas normal, l'annoncer serait du bruit.
  const tone = strength === "faible" ? TONE_CLASS.cool : TONE_CLASS[meta.tone];
  return (
    <span title={title} className={`${BASE} ${tone}`}>
      {meta.label}
      {strength && strength !== "fort" && <span className="opacity-70">· {strength}</span>}
    </span>
  );
}

/** Force d'un signal, du plus décisif au plus anecdotique. Absente = inconnue. */
export type SignalStrength = "fort" | "moyen" | "faible";

const RANK: Record<string, number> = { fort: 3, moyen: 2, faible: 1 };

/** Ordonne deux forces. Une force absente passe après « faible ». */
export const strengthRank = (strength: string | undefined): number => RANK[strength ?? ""] ?? 0;

const STRENGTH_CLASS: Record<SignalStrength, string> = {
  fort: "border-warn/25 bg-warn/10 text-warn-ink",
  moyen: "border-primary/25 bg-primary/10 text-primary-ink",
  faible: "border-line bg-surface-2 text-faint",
};

/**
 * Force du meilleur signal de la fiche.
 *
 * Posé en tête de carte et non dans la liste des puces : c'est la première
 * question qu'on se pose devant un résultat (« est-ce que ça vaut un mail
 * aujourd'hui ? »), avant même de savoir de quel type de signal il s'agit.
 */
export function StrengthBadge({ strength }: { strength: string | undefined }) {
  if (strength !== "fort" && strength !== "moyen" && strength !== "faible") return null;
  return (
    <span className={`${BASE} ${STRENGTH_CLASS[strength]}`}>signal {strength}</span>
  );
}

/** Puce neutre : secteur, effectif, ville… information sans charge sémantique. */
export function MetaChip({ children }: { children: React.ReactNode }) {
  return <span className={`${BASE} border-line bg-surface-2 text-muted`}>{children}</span>;
}

/** Marque explicite pour toute valeur illustrative — jamais une donnée réelle. */
export function ExampleTag({ label = "exemple" }: { label?: string }) {
  return (
    <span className="font-data inline-flex items-center rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">
      {label}
    </span>
  );
}
