/**
 * Adresses protégées par Cloudflare (Cowork #33) — code pur.
 *
 * Cloudflare remplace une adresse publiée par `data-cfemail="…"` ou un lien
 * `/cdn-cgi/l/email-protection#…` : de l'hexadécimal dont le premier octet est
 * la clé XOR des suivants. L'étape e-mail ne les décode pas encore.
 */
export function decodeCfEmails(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/(?:data-cfemail="|email-protection#)([0-9a-f]{6,})/gi)) {
    const hex = match[1];
    const key = parseInt(hex.slice(0, 2), 16);
    let email = "";
    for (let index = 2; index < hex.length; index += 2) email += String.fromCharCode(parseInt(hex.slice(index, index + 2), 16) ^ key);
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) out.push(email.toLowerCase());
  }
  return [...new Set(out)];
}
