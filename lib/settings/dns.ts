import { resolveTxt } from "node:dns/promises";

/**
 * Réglages › Délivrabilité — SPF, DKIM et DMARC du domaine d'envoi, lus en
 * DNS côté serveur. L'envoi part de Google Workspace (docs/n8n.md) : SPF doit
 * inclure _spf.google.com, et la clé DKIM est publiée sous le sélecteur
 * « google ».
 */

export const SENDING_DOMAIN = process.env.SENDING_DOMAIN?.trim() || "axelremillat.com";
export const DKIM_SELECTOR = process.env.DKIM_SELECTOR?.trim() || "google";

export type DnsVerdict = "ok" | "attention" | "absent" | "erreur";

export interface DnsCheck {
  name: "SPF" | "DKIM" | "DMARC";
  host: string;
  verdict: DnsVerdict;
  detail: string;
  record: string | null;
}

export type TxtResolver = (host: string) => Promise<string[][]>;

const join = (records: string[][]) => records.map((parts) => parts.join(""));

export function judgeSpf(records: string[]): Omit<DnsCheck, "name" | "host"> {
  const spf = records.filter((record) => /^v=spf1\b/i.test(record));
  if (!spf.length) return { verdict: "absent", detail: "aucun enregistrement SPF", record: null };
  if (spf.length > 1) return { verdict: "attention", detail: "plusieurs SPF : un seul est permis", record: spf.join(" | ") };
  const record = spf[0];
  if (!/include:_spf\.google\.com/i.test(record)) return { verdict: "attention", detail: "n'inclut pas _spf.google.com (envoi Google Workspace)", record };
  if (/\+all\b/i.test(record)) return { verdict: "attention", detail: "« +all » : tout le monde peut envoyer en votre nom", record };
  return { verdict: "ok", detail: "inclut Google Workspace", record };
}

export function judgeDkim(records: string[]): Omit<DnsCheck, "name" | "host"> {
  const dkim = records.find((record) => /\bv=DKIM1\b/i.test(record) || /\bp=[A-Za-z0-9+/]{20,}/.test(record));
  if (!dkim) return { verdict: "absent", detail: "aucune clé publiée sous ce sélecteur", record: null };
  if (/\bp=\s*(;|$)/.test(dkim)) return { verdict: "attention", detail: "clé révoquée (p= vide)", record: dkim };
  return { verdict: "ok", detail: "clé publiée", record: dkim.length > 80 ? `${dkim.slice(0, 77)}…` : dkim };
}

export function judgeDmarc(records: string[]): Omit<DnsCheck, "name" | "host"> {
  const dmarc = records.find((record) => /^v=DMARC1\b/i.test(record));
  if (!dmarc) return { verdict: "absent", detail: "aucun enregistrement DMARC", record: null };
  const policy = /\bp=(none|quarantine|reject)\b/i.exec(dmarc)?.[1]?.toLowerCase();
  if (!policy) return { verdict: "attention", detail: "politique p= manquante", record: dmarc };
  if (policy === "none") return { verdict: "attention", detail: "p=none : surveillance seule, aucune protection", record: dmarc };
  return { verdict: "ok", detail: `p=${policy}`, record: dmarc };
}

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "ENOTIMP", "NXDOMAIN"]);

async function lookup(resolver: TxtResolver, host: string): Promise<string[] | Error> {
  try {
    return join(await resolver(host));
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code && NOT_FOUND.has(code) ? [] : new Error(code ?? "DNS injoignable");
  }
}

export async function checkDomain(domain = SENDING_DOMAIN, resolver: TxtResolver = resolveTxt, selector = DKIM_SELECTOR): Promise<DnsCheck[]> {
  const hosts = { SPF: domain, DKIM: `${selector}._domainkey.${domain}`, DMARC: `_dmarc.${domain}` } as const;
  const judges = { SPF: judgeSpf, DKIM: judgeDkim, DMARC: judgeDmarc } as const;
  return Promise.all(
    (Object.keys(hosts) as (keyof typeof hosts)[]).map(async (name) => {
      const records = await lookup(resolver, hosts[name]);
      if (records instanceof Error) return { name, host: hosts[name], verdict: "erreur" as const, detail: records.message, record: null };
      return { name, host: hosts[name], ...judges[name](records) };
    }),
  );
}
