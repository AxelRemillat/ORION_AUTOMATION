import type { Evidence } from "@/app/api/emails/generate/prompt";

/**
 * « Faits réels retenus » — grille à trois colonnes.
 *
 * L'ancienne version alignait la valeur à droite dans un `justify-between` :
 * un texte long se retrouvait écrasé entre le label et la source, et se lisait
 * de travers. Ici les colonnes sont fixes — label 160 px, valeur pleine
 * largeur alignée à gauche, source 220 px tronquée — donc la lecture reste
 * horizontale quelle que soit la longueur.
 */

const normalize = (value: string): string =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const significant = (value: string): Set<string> =>
  new Set((normalize(value).match(/[a-z0-9]{4,}/g) ?? []));

/**
 * Écarte les faits qui répètent un fait déjà affiché.
 *
 * Cas réel : un signal « créée le 1 janvier 1969, il y a 58 ans » s'affichait
 * sous l'âge de l'entreprise calculé à 57 ans. Deux lignes, une contradiction
 * apparente, et rien de neuf dans la seconde. La règle : si tout le vocabulaire
 * porteur d'un fait est déjà présent dans un fait précédent, on ne le remontre
 * pas — le premier est celui qu'on a calculé, donc celui en qui on a confiance.
 */
export function dedupeFacts(facts: Evidence[]): Evidence[] {
  const kept: Evidence[] = [];
  const seenWords: Set<string>[] = [];

  for (const fact of facts) {
    const key = normalize(`${fact.label} ${fact.value}`);
    if (kept.some((other) => normalize(`${other.label} ${other.value}`) === key)) continue;

    const own = significant(fact.value);
    if (own.size > 0) {
      const covered = seenWords.some((previous) => {
        let shared = 0;
        for (const word of own) if (previous.has(word)) shared += 1;
        return shared === own.size;
      });
      if (covered) continue;
    }

    kept.push(fact);
    seenWords.push(own);
  }
  return kept;
}

export function FactsGrid({ facts }: { facts: Evidence[] }) {
  const rows = dedupeFacts(facts);
  if (!rows.length) return null;

  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {rows.map((fact) => (
        <li
          key={`${fact.label}-${fact.value}`}
          className="grid grid-cols-1 gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[160px_minmax(0,1fr)_220px]"
        >
          <span className="text-[13px] text-muted">{fact.label}</span>

          <span className="min-w-0 text-left text-[13px] leading-relaxed text-text">
            {fact.value}
          </span>

          {fact.url ? (
            <a
              href={fact.url}
              target="_blank"
              rel="noreferrer noopener"
              title={`${fact.source} — ${fact.url}`}
              className="min-w-0 truncate font-data text-[11px] text-primary-ink underline decoration-dotted underline-offset-2"
            >
              {fact.source}
            </a>
          ) : (
            <span
              title={fact.source}
              className="min-w-0 truncate font-data text-[11px] text-faint"
            >
              {fact.source}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
