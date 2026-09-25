import type { StrategyBrief } from "@/lib/emails/strategist";
import { chooseProof, entryOfferLabel } from "@/lib/offer/model";
import type { UserOffer } from "@/types";

/**
 * Partie non éditable du brief : ce qui fonde l'angle et ce qu'il ne faut
 * pas dire. Lu d'un coup d'œil avant d'envoyer.
 */
export function BriefDetails({ brief, offer }: { brief: StrategyBrief; offer: UserOffer }) {
  // La preuve et la demande d'entree viennent de /offre : on montre ce qui a
  // reellement ete retenu, pas ce que le stratege avait propose.
  const choice = chooseProof(offer, `${brief.pain.task} ${brief.pain.automationIdea}`);
  const entry = entryOfferLabel(offer);

  return (
    <dl className="grid gap-3 text-[13px] leading-relaxed">
      <Row label="Flux proposé">{brief.pain.automationIdea}</Row>
      <Row label="Pourquoi eux">
        faits {brief.pain.whyThem.join(", ")} · accroche sur {brief.angle.hookFactIds.join(", ")}
      </Row>
      <Row label="Preuve retenue">
        {choice.sentence ? (
          <>
            <span className="font-data text-faint">{choice.proof?.id}</span> « {choice.sentence} »
            <span className="block text-[12px] text-muted">{choice.reason}</span>
          </>
        ) : (
          <>
            aucune — le mail décrit ce qu&apos;Axel construit
            <span className="block text-[12px] text-muted">{choice.reason}</span>
          </>
        )}
      </Row>
      <Row label="Demande d'entrée">
        {entry ? `${entry}${offer.entry_pitch ? ` — « ${offer.entry_pitch} »` : ""}` : "aucune : complétez /offre"}
      </Row>
      <Row label="Test de substitution">
        appliqué par le juge sur la première phrase — un score de spécificité sous 3 déclenche une
        réécriture
      </Row>
      <Row label="Question de fin">{brief.cta}</Row>
      {brief.avoid.length > 0 && (
        <Row label="À ne pas dire">
          <ul className="list-disc pl-4">
            {brief.avoid.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Row>
      )}
      <Row label="Faits retenus">
        <ul className="flex flex-col gap-0.5">
          {brief.rankedFacts.map((item) => (
            <li key={item.id}>
              <span className="font-data text-faint">{item.id}</span> {item.reason}
            </li>
          ))}
        </ul>
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-text">{children}</dd>
    </div>
  );
}
