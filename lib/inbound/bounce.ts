/**
 * Rebonds : ORION ne reçoit pas de notification de non-distribution dédiée.
 * Un rebond se reconnaît dans la boîte de réception (mailer-daemon, postmaster,
 * « Delivery Status Notification », « Undeliverable »…).
 */
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|noreply-dmarc)@/i;
const BOUNCE_SUBJECT = /delivery status notification|undeliverable|undelivered mail|mail delivery (failed|subsystem)|non remis|échec de (la )?remise|returned mail/i;

export function isBounce(message: { from_email: string; subject?: string | null }): boolean {
  return BOUNCE_SENDER.test((message.from_email ?? "").trim()) || BOUNCE_SUBJECT.test(message.subject ?? "");
}
