import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";

/** Consigne de rédaction : au-delà, un cold email perd son efficacité. */
const MAX_WORDS = 120;

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Aperçu du brouillon tel qu'il arrivera dans la boîte du destinataire.
 * Lecture seule : c'est l'éditeur, à gauche, qui fait foi.
 */
export function DraftPreview({
  subject,
  body,
  to,
}: {
  subject: string;
  body: string;
  /** Destinataire connu, ou `null` si aucune adresse n'est encore trouvée. */
  to: string | null;
}) {
  const words = countWords(body);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle>Aperçu</CardTitle>
          <span
            className="font-data text-[11px]"
            style={{ color: words > MAX_WORDS ? "var(--warn)" : "var(--faint)" }}
          >
            {words} / {MAX_WORDS} mots
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <div className="rounded-lg border border-line bg-surface-2">
          <div className="space-y-1 border-b border-line px-4 py-3">
            <p className="font-data text-[11px] text-faint">
              De : axel@axelremillat.com
            </p>
            <p className="font-data text-[11px] text-faint">
              À : {to ?? "adresse à confirmer à l'envoi"}
            </p>
            <p className="pt-1 font-display text-[15px] font-semibold leading-snug text-text">
              {subject.trim() || "(sans objet)"}
            </p>
          </div>

          <div className="px-4 py-3">
            {body.trim() ? (
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">{body}</p>
            ) : (
              <p className="text-[13px] text-faint">
                Le corps du message apparaîtra ici au fil de la rédaction.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
