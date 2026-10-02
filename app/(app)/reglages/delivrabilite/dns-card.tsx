import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { DnsCheck } from "@/lib/settings/dns";

/** SPF, DKIM, DMARC du domaine d'envoi, lus en DNS côté serveur. */

const TONE = { ok: "success", attention: "warning", absent: "danger", erreur: "neutral" } as const;

export function DnsCard({ domain, checks }: { domain: string; checks: DnsCheck[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentification du domaine</CardTitle>
        <CardDescription>
          Domaine d&apos;envoi <span className="font-data text-text">{domain}</span> (Google Workspace). Lecture DNS à l&apos;ouverture de la page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {checks.map((check) => (
            <li key={check.name} className="flex flex-col gap-1 border-b border-line-soft py-2.5 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-[14px] font-medium text-text">{check.name}</span>
                <Badge tone={TONE[check.verdict]}>{check.verdict}</Badge>
                <span className="text-[13px] text-muted">{check.detail}</span>
              </div>
              <span className="font-data text-[11px] text-faint">{check.host}</span>
              {check.record && <code className="break-all font-data text-[11px] text-muted">{check.record}</code>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
