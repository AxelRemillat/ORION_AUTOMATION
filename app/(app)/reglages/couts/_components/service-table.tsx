import { Badge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { formatEur } from "@/lib/utils";
import type { ApiService } from "@/types";
import type { ServiceBalance } from "@/lib/usage/balances";
import type { ServiceUsage } from "../_lib/aggregate";

/** Unite consommee, par service. */
const UNITS: Record<ApiService, string> = {
  openai: "tokens",
  pappers: "crédits",
  linkup: "recherches",
  hunter: "recherches",
};

const number = new Intl.NumberFormat("fr-FR");

/**
 * Consommation et solde, service par service.
 *
 * La colonne « Reste » porte toujours son origine : `exact` quand le chiffre
 * vient de l'API du fournisseur, `estimé` quand l'app le reconstitue. Les deux
 * ne se valent pas et ne doivent jamais se confondre.
 */
export function ServiceTable({
  usage,
  balances,
  labels,
}: {
  usage: ServiceUsage[];
  balances: ServiceBalance[];
  labels: Record<ApiService, string>;
}) {
  const balanceOf = (service: ApiService) => balances.find((item) => item.service === service);

  return (
    <Table>
      <THead>
        <TR>
          <TH>Service</TH>
          <TH className="text-right">Appels</TH>
          <TH className="text-right">Consommé</TH>
          <TH className="text-right">Coût</TH>
          <TH>Reste</TH>
        </TR>
      </THead>
      <TBody>
        {usage.map((entry) => {
          const balance = balanceOf(entry.service);
          return (
            <TR key={entry.service}>
              <TD className="font-medium">{labels[entry.service]}</TD>
              <TD className="text-right font-data text-[13px]">{number.format(entry.calls)}</TD>
              <TD className="text-right font-data text-[13px] text-muted">
                {number.format(Math.round(entry.units))} {UNITS[entry.service]}
              </TD>
              <TD className="text-right font-data text-[13px]">
                {entry.cost > 0 ? formatEur(entry.cost) : "—"}
              </TD>
              <TD>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-data text-[13px]">
                      {balance?.remaining != null
                        ? `${number.format(balance.remaining)} ${balance.unit}`
                        : "inconnu"}
                    </span>
                    {balance?.remaining != null && (
                      <Badge tone={balance.quality === "exact" ? "success" : "warning"}>
                        {balance.quality === "exact" ? "exact" : "estimé"}
                      </Badge>
                    )}
                  </span>
                  <span className="text-[11px] leading-snug text-faint">
                    {balance?.basis}
                    {balance?.error ? ` (${balance.error})` : ""}
                  </span>
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
