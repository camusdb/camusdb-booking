import { appUrl, gatewaySecretKey, type CreateIntentParams, type PaymentIntent, type Refund } from './gateway';

/** What the relay needs from a payment gateway. Tests pass a stub; the app passes the HTTP client. */
export interface PaymentGatewayClient {
  createPaymentIntent(params: CreateIntentParams, idempotencyKey: string): Promise<PaymentIntent>;
  createRefund(params: { payment_intent: string }, idempotencyKey: string): Promise<Refund>;
}

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    /** False when the gateway rejected the request itself, so a retry cannot succeed. */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

function gatewayBaseUrl(): string {
  return process.env.PAYMENT_GATEWAY_URL || `${appUrl()}/api/gateway/v1`;
}

async function post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${gatewayBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${gatewaySecretKey()}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new GatewayRequestError(error instanceof Error ? error.message : String(error), true);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Gateway answered ${response.status}.`;
    // A 4xx other than 409 and 429 is a rejected request. A 5xx, 409, or 429 can pass on a later try.
    const retryable = response.status >= 500 || response.status === 409 || response.status === 429;
    throw new GatewayRequestError(`${response.status} ${message}`, retryable);
  }
  return payload as T;
}

export const httpGateway: PaymentGatewayClient = {
  createPaymentIntent: (params, idempotencyKey) => post<PaymentIntent>('/payment_intents', params, idempotencyKey),
  createRefund: (params, idempotencyKey) => post<Refund>('/refunds', params, idempotencyKey),
};
