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
export function FactsGrid({ facts }: { facts: Evidence[] }) {
  if (!facts.length) return null;

  return (
    <ul className="flex flex-col divide-y divide-line-soft">
      {facts.map((fact) => (
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
