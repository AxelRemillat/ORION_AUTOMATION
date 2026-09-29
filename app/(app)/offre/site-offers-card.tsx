import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { SITE_OFFERS, SITE_OFFERS_SOURCE, SITE_OFFERS_URL } from "@/lib/offer/site-offers";

/**
 * Les 4 offres du site, en lecture seule.
 *
 * Elles ne s'éditent pas ici : la vérité est sur le site (PORTFOLIO_V2), et
 * ORION n'en garde qu'une copie contrôlée (`npm run check:site-offers`). Les
 * modifier dans ORION seul, c'était annoncer au prospect un prix que le site
 * contredit.
 */
export function SiteOffersCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Offres du site</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="grid gap-3 sm:grid-cols-2">
          {SITE_OFFERS.map((offer) => (
            <li key={offer.name} className="rounded-lg border border-line-soft bg-surface-2/60 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-text">{offer.name}</span>
                <span className="font-data text-xs text-primary-ink">{offer.price}</span>
              </div>
              <p className="mt-1 text-[13px] text-muted">{offer.pitch}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint">
          Lecture seule : mêmes intitulés et prix que{" "}
          <a href={SITE_OFFERS_URL} target="_blank" rel="noreferrer" className="text-primary-ink hover:underline">
            axelremillat.com/offres
          </a>
          . Source : <span className="font-data">{SITE_OFFERS_SOURCE}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
