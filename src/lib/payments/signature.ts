import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'gateway-signature';
const TOLERANCE_SECONDS = 300;

export function webhookSecret(): string {
  return process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_camusbooking_demo';
}

function digest(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Builds a header in the `Stripe-Signature` format: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export function signPayload(body: string, secret = webhookSecret(), timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${digest(secret, timestamp, body)}`;
}

/**
 * Checks the signature against the raw body. The timestamp is part of the signed text, so a replay of
 * an old delivery fails once it is older than the tolerance.
 */
export function verifySignature(
  body: string,
  header: string | null,
  secret = webhookSecret(),
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!header) return false;
  const parts = new Map(
    header.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1');
  if (!Number.isInteger(timestamp) || !signature) return false;
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(digest(secret, timestamp, body), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
