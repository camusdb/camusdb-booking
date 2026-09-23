import { signPayload, SIGNATURE_HEADER } from './signature';
import type { PaymentMethod } from '../types';

/*
 * A small in-memory copy of a Stripe-like payment gateway. It stands in for an external service, so it
 * keeps its own state instead of the app database, and it talks to the app only over HTTP: the relay
 * calls its API routes, and it calls the app's webhook route. The state lives on globalThis because Next
 * bundles the route handlers and the instrumentation hook as separate module graphs. A restart clears it.
 */

export interface GatewayConfig {
  /** Every API call fails with 503, as in a gateway outage. */
  unavailable: boolean;
  /** Every webhook event is delivered two times, as an at-least-once sender can do. */
  duplicateWebhooks: boolean;
  /** How long a payment intent stays `processing` before its outcome and its webhook. */
  webhookDelayMs: number;
}

export type IntentStatus = 'processing' | 'succeeded' | 'requires_payment_method';

export interface PaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  amount_refunded: number;
  currency: string;
  status: IntentStatus;
  payment_method: PaymentMethod;
  metadata: Record<string, string>;
  last_payment_error: { code: string; message: string } | null;
  created: number;
}

export interface Refund {
  id: string;
  object: 'refund';
  amount: number;
  payment_intent: string;
  status: 'succeeded';
  created: number;
}

export type GatewayEventType = 'payment_intent.succeeded' | 'payment_intent.payment_failed';

export interface GatewayEvent {
  id: string;
  object: 'event';
  type: GatewayEventType;
  created: number;
  data: { object: PaymentIntent };
}

export interface WebhookDelivery {
  eventId: string;
  type: GatewayEventType;
  intentId: string;
  attempt: number;
  httpStatus: number | null;
  error: string | null;
  at: string;
}

export interface GatewayIntentView extends PaymentIntent {
  /** Create requests the gateway received for this intent, including idempotent replays. */
  requests: number;
}

export interface GatewaySnapshot {
  config: GatewayConfig;
  intents: GatewayIntentView[];
  deliveries: WebhookDelivery[];
}

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }

  toJSON() {
    return { error: { type: this.status >= 500 ? 'api_error' : 'invalid_request_error', code: this.code, message: this.message } };
  }
}

interface CachedResponse {
  fingerprint: string;
  body: PaymentIntent | Refund;
}

interface GatewayState {
  config: GatewayConfig;
  intents: Map<string, PaymentIntent>;
  requests: Map<string, number>;
  refunds: Map<string, Refund>;
  idempotency: Map<string, CachedResponse>;
  deliveries: WebhookDelivery[];
}

const MAX_DELIVERY_ATTEMPTS = 5;
const MAX_LOGGED_DELIVERIES = 50;

const outcomes: Record<PaymentMethod, { code: string; message: string } | null> = {
  pm_card_visa: null,
  pm_card_chargeDeclined: { code: 'card_declined', message: 'Your card was declined.' },
  pm_card_chargeDeclinedInsufficientFunds: { code: 'insufficient_funds', message: 'Your card has insufficient funds.' },
};

export const paymentMethods = Object.keys(outcomes) as PaymentMethod[];

const globalKey = Symbol.for('camusbooking.gateway');

function defaultConfig(): GatewayConfig {
  return { unavailable: false, duplicateWebhooks: false, webhookDelayMs: 1500 };
}

function state(): GatewayState {
  const scope = globalThis as typeof globalThis & { [globalKey]?: GatewayState };
  scope[globalKey] ??= {
    config: defaultConfig(),
    intents: new Map(),
    requests: new Map(),
    refunds: new Map(),
    idempotency: new Map(),
    deliveries: [],
  };
  return scope[globalKey];
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function gatewaySecretKey(): string {
  return process.env.PAYMENT_GATEWAY_SECRET_KEY || 'sk_test_camusbooking';
}

export function appUrl(): string {
  return process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function webhookUrl(): string {
  return process.env.PAYMENT_WEBHOOK_URL || `${appUrl()}/api/webhooks/payments`;
}

export function authorize(header: string | null): void {
  if (header !== `Bearer ${gatewaySecretKey()}`) {
    throw new GatewayError(401, 'unauthorized', 'Invalid API key provided.');
  }
}

/**
 * Returns the cached response for a key that the gateway already saw. A key sent again with other
 * parameters is an error, as it is on Stripe, because it means two different requests share a key.
 */
function replay(key: string | null, fingerprint: string): PaymentIntent | Refund | undefined {
  if (!key) return undefined;
  const cached = state().idempotency.get(key);
  if (!cached) return undefined;
  if (cached.fingerprint !== fingerprint) {
    throw new GatewayError(400, 'idempotency_key_in_use', 'Keys for idempotent requests can only be used with the same parameters.');
  }
  return cached.body;
}

export interface CreateIntentParams {
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  metadata?: Record<string, string>;
}

export function createPaymentIntent(params: CreateIntentParams, idempotencyKey: string | null): PaymentIntent {
  const gateway = state();
  if (gateway.config.unavailable) throw new GatewayError(503, 'service_unavailable', 'The gateway is unavailable.');

  const fingerprint = JSON.stringify(['intent', params.amount, params.currency, params.payment_method, params.metadata ?? {}]);
  const cached = replay(idempotencyKey, fingerprint) as PaymentIntent | undefined;
  if (cached) {
    gateway.requests.set(cached.id, (gateway.requests.get(cached.id) ?? 0) + 1);
    return { ...cached };
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new GatewayError(400, 'parameter_invalid_integer', 'amount must be a positive integer in cents.');
  }
  if (!(params.payment_method in outcomes)) {
    throw new GatewayError(400, 'resource_missing', `No such PaymentMethod: '${params.payment_method}'.`);
  }

  const intent: PaymentIntent = {
    id: randomId('pi'),
    object: 'payment_intent',
    amount: params.amount,
    amount_refunded: 0,
    currency: params.currency,
    status: 'processing',
    payment_method: params.payment_method,
    metadata: params.metadata ?? {},
    last_payment_error: null,
    created: unixNow(),
  };
  gateway.intents.set(intent.id, intent);
  gateway.requests.set(intent.id, 1);
  if (idempotencyKey) gateway.idempotency.set(idempotencyKey, { fingerprint, body: intent });

  setTimeout(() => settle(intent.id), gateway.config.webhookDelayMs);
  return { ...intent };
}

export function createRefund(params: { payment_intent: string }, idempotencyKey: string | null): Refund {
  const gateway = state();
  if (gateway.config.unavailable) throw new GatewayError(503, 'service_unavailable', 'The gateway is unavailable.');

  const fingerprint = JSON.stringify(['refund', params.payment_intent]);
  const cached = replay(idempotencyKey, fingerprint) as Refund | undefined;
  if (cached) return cached;

  const intent = gateway.intents.get(params.payment_intent);
  if (!intent) throw new GatewayError(404, 'resource_missing', `No such payment_intent: '${params.payment_intent}'.`);
  if (intent.status !== 'succeeded') {
    throw new GatewayError(400, 'payment_intent_unexpected_state', 'Only a succeeded payment can be refunded.');
  }
  if (intent.amount_refunded >= intent.amount) {
    throw new GatewayError(400, 'charge_already_refunded', 'The charge is already refunded.');
  }

  intent.amount_refunded = intent.amount;
  const refund: Refund = {
    id: randomId('re'),
    object: 'refund',
    amount: intent.amount,
    payment_intent: intent.id,
    status: 'succeeded',
    created: unixNow(),
  };
  gateway.refunds.set(refund.id, refund);
  if (idempotencyKey) gateway.idempotency.set(idempotencyKey, { fingerprint, body: refund });
  return refund;
}

function settle(intentId: string): void {
  const intent = state().intents.get(intentId);
  if (!intent || intent.status !== 'processing') return;

  const failure = outcomes[intent.payment_method];
  intent.status = failure ? 'requires_payment_method' : 'succeeded';
  intent.last_payment_error = failure;

  const event: GatewayEvent = {
    id: randomId('evt'),
    object: 'event',
    type: failure ? 'payment_intent.payment_failed' : 'payment_intent.succeeded',
    created: unixNow(),
    data: { object: { ...intent } },
  };
  void deliver(event, 1);
  if (state().config.duplicateWebhooks) setTimeout(() => void deliver(event, 1), 200);
}

async function deliver(event: GatewayEvent, attempt: number): Promise<void> {
  const body = JSON.stringify(event);
  let httpStatus: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(webhookUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signPayload(body) },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    if (!response.ok) error = (await response.text()).slice(0, 200);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const log = state().deliveries;
  log.unshift({
    eventId: event.id,
    type: event.type,
    intentId: event.data.object.id,
    attempt,
    httpStatus,
    error,
    at: new Date().toISOString(),
  });
  log.length = Math.min(log.length, MAX_LOGGED_DELIVERIES);

  // Like Stripe, a delivery that does not get a 2xx answer is sent again later with a longer wait.
  if (error !== null && attempt < MAX_DELIVERY_ATTEMPTS) {
    setTimeout(() => void deliver(event, attempt + 1), 1000 * 2 ** (attempt - 1));
  }
}

export function snapshot(limit = 20): GatewaySnapshot {
  const gateway = state();
  const intents = [...gateway.intents.values()]
    .sort((a, b) => b.created - a.created)
    .slice(0, limit)
    .map((intent) => ({ ...intent, requests: gateway.requests.get(intent.id) ?? 0 }));
  return { config: { ...gateway.config }, intents, deliveries: gateway.deliveries.slice(0, limit) };
}

export function configure(patch: Partial<GatewayConfig>): GatewayConfig {
  const config = state().config;
  if (typeof patch.unavailable === 'boolean') config.unavailable = patch.unavailable;
  if (typeof patch.duplicateWebhooks === 'boolean') config.duplicateWebhooks = patch.duplicateWebhooks;
  if (typeof patch.webhookDelayMs === 'number' && patch.webhookDelayMs >= 0) {
    config.webhookDelayMs = Math.min(patch.webhookDelayMs, 60_000);
  }
  return { ...config };
}
