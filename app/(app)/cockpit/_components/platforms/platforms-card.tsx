import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { PLATFORM_LABELS } from "@/lib/opportunities/types";
import type { PlatformActivity } from "@/lib/opportunities/stats";

const METRICS = [
  { key: "sent", label: "Envoyées" },
  { key: "replies", label: "Réponses" },
  { key: "conversations", label: "Conversations" },
  { key: "won", label: "Gagnées" },
] as const;

/**
 * Plateformes freelance (Codeur, Upwork, Malt, ComeUp) : propositions
 * envoyées, réponses, conversations et missions gagnées, sur 7 et 30 jours.
 * Chaque jalon compte à sa date ; rien n'est inventé.
 */
export function PlatformsCard({ week, month }: { week: PlatformActivity[]; month: PlatformActivity[] }) {
  const platforms = month.map((row) => row.platform);
  const weekOf = (platform: PlatformActivity["platform"]) => week.find((row) => row.platform === platform);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Plateformes freelance</CardTitle>
        <CardDescription>
          Propositions envoyées, réponses, conversations et missions gagnées, par plateforme : 7 derniers jours / 30 derniers jours.{" "}
          <Link href="/opportunites" className="text-primary-ink underline-offset-2 hover:underline">
            Opportunités
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {platforms.length === 0 ? (
          <p className="text-[13px] text-faint">Aucune activité sur les plateformes ces 30 derniers jours.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="py-1 pr-2 font-normal">Plateforme</th>
                  {METRICS.map((metric) => (
                    <th key={metric.key} className="py-1 pr-2 text-right font-normal">
                      {metric.label} <span className="font-data">7 j / 30 j</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.map((row) => (
                  <tr key={row.platform} className="border-t border-line-soft">
                    <td className="py-1.5 pr-2 text-text">{PLATFORM_LABELS[row.platform]}</td>
                    {METRICS.map((metric) => (
                      <td key={metric.key} className="py-1.5 pr-2 text-right font-data">
                        <span className={metric.key === "won" && row.won ? "text-good-ink" : "text-text"}>{weekOf(row.platform)?.[metric.key] ?? 0}</span>
                        <span className="text-faint"> / {row[metric.key]}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
