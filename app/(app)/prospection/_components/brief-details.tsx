import { PERSONA } from "@/lib/persona";
import type { StrategyBrief } from "@/lib/emails/strategist";

/**
 * Partie non éditable du brief : ce qui fonde l'angle et ce qu'il ne faut
 * pas dire. Lu d'un coup d'œil avant d'envoyer.
 */
export function BriefDetails({ brief }: { brief: StrategyBrief }) {
  const proof = PERSONA.proofs.find((item) => item.id === brief.proofId && item.publicOk);

  return (
    <dl className="grid gap-3 text-[13px] leading-relaxed">
      <Row label="Flux proposé">{brief.pain.automationIdea}</Row>
      <Row label="Pourquoi eux">
        faits {brief.pain.whyThem.join(", ")} · accroche sur {brief.angle.hookFactIds.join(", ")}
      </Row>
      <Row label="Preuve">{proof ? `« ${proof.text} »` : "aucune — le mail décrit ce qu'Axel construit"}</Row>
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
