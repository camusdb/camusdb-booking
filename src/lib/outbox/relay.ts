import { camus, withRetry, type CamusClient, type CamusTransaction } from 'camusdb';
import { listBranches } from '../camus/admin';
import { getClient, rootDatabase } from '../camus/client';
import { mapOutbox, outboxSelect, type OutboxRow } from '../camus/map';
import { GatewayRequestError, httpGateway, type PaymentGatewayClient } from '../payments/gateway-client';
import { abandonPayment, attachIntent, completeRefund } from '../services/payments';
import type { OutboxMessage, RelayState } from '../types';
import type { PaymentRequestedPayload, RefundRequestedPayload } from './outbox';

const POLL_MS = 1000;
const BATCH_SIZE = 10;
/** How long a claimed message stays hidden from other relays. A relay that dies loses its claim after this. */
export const LEASE_MS = 5000;
export const MAX_ATTEMPTS = 5;

export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** (attempts - 1), 30_000);
}

/** Stands in for a relay process that dies after the gateway call and before it records the result. */
class SimulatedCrash extends Error {}

export interface ProcessOptions {
  gateway?: PaymentGatewayClient;
  /** Called after each successful gateway call. True makes the relay stop there, as if it crashed. */
  crashAfterPublish?: () => boolean;
}

/**
 * Takes up to one batch of due messages. Each claim moves `next_attempt_at` one lease ahead and counts
 * the attempt, in one transaction. Two relays that claim the same row conflict, and the loser retries
 * and no longer sees it as due.
 */
async function claim(client: CamusClient, now: Date): Promise<OutboxMessage[]> {
  return withRetry(async () => {
    await using txn = await client.beginTransaction();
    try {
      const { rows } = await client.query<OutboxRow>(
        `${outboxSelect} WHERE status = 'pending' AND next_attempt_at <= @now ORDER BY created_at LIMIT ${BATCH_SIZE}`,
        { now },
        { transaction: txn },
      );
      const leaseEnd = new Date(now.getTime() + LEASE_MS);
      for (const row of rows) {
        await client.execute(
          'UPDATE outbox SET attempts = @attempts, next_attempt_at = @leaseEnd, updated_at = @now WHERE id = @id',
          { attempts: Number(row.attempts) + 1, leaseEnd, now, id: camus.id(row.id) },
          { transaction: txn },
        );
      }
      await txn.commit();
      return rows.map((row) => ({ ...mapOutbox(row), attempts: Number(row.attempts) + 1 }));
    } catch (error) {
      await txn.rollback();
      throw error;
    }
  });
}

async function inTransaction(client: CamusClient, work: (txn: CamusTransaction) => Promise<void>): Promise<void> {
  await withRetry(async () => {
    await using txn = await client.beginTransaction();
    try {
      await work(txn);
      await txn.commit();
    } catch (error) {
      await txn.rollback();
      throw error;
    }
  });
}

async function markSent(client: CamusClient, txn: CamusTransaction, id: string): Promise<void> {
  await client.execute(
    "UPDATE outbox SET status = 'sent', last_error = '', updated_at = @now WHERE id = @id",
    { now: new Date(), id: camus.id(id) },
    { transaction: txn },
  );
}

async function publish(
  client: CamusClient,
  database: string,
  message: OutboxMessage,
  gateway: PaymentGatewayClient,
  crashAfterPublish: () => boolean,
): Promise<void> {
  // The message id is the idempotency key, so every attempt at one message is one request to the
  // gateway, however many times the relay sends it.
  if (message.topic === 'payment.requested') {
    const payload = JSON.parse(message.payload) as PaymentRequestedPayload;
    const intent = await gateway.createPaymentIntent(
      {
        amount: payload.amountCents,
        currency: payload.currency,
        payment_method: payload.paymentMethod,
        metadata: { booking_id: payload.bookingId, payment_id: payload.paymentId, pnr: payload.pnr, database },
      },
      message.id,
    );
    if (crashAfterPublish()) throw new SimulatedCrash();
    await inTransaction(client, async (txn) => {
      await markSent(client, txn, message.id);
      await attachIntent(client, txn, payload.paymentId, intent.id);
    });
    return;
  }

  if (message.topic === 'refund.requested') {
    const payload = JSON.parse(message.payload) as RefundRequestedPayload;
    await gateway.createRefund({ payment_intent: payload.intentId }, message.id);
    if (crashAfterPublish()) throw new SimulatedCrash();
    await inTransaction(client, async (txn) => {
      await markSent(client, txn, message.id);
      await completeRefund(client, txn, payload.bookingId, payload.paymentId);
    });
    return;
  }

  throw new GatewayRequestError(`Unknown outbox topic ${message.topic}.`, false);
}

async function recordFailure(client: CamusClient, message: OutboxMessage, error: unknown): Promise<void> {
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const retryable = !(error instanceof GatewayRequestError) || error.retryable;

  await inTransaction(client, async (txn) => {
    const now = new Date();
    if (retryable && message.attempts < MAX_ATTEMPTS) {
      await client.execute(
        'UPDATE outbox SET next_attempt_at = @next, last_error = @reason, updated_at = @now WHERE id = @id',
        { next: new Date(now.getTime() + backoffMs(message.attempts)), reason, now, id: camus.id(message.id) },
        { transaction: txn },
      );
      return;
    }

    await client.execute(
      "UPDATE outbox SET status = 'dead', last_error = @reason, updated_at = @now WHERE id = @id",
      { reason, now, id: camus.id(message.id) },
      { transaction: txn },
    );
    if (message.topic === 'payment.requested') {
      const payload = JSON.parse(message.payload) as PaymentRequestedPayload;
      await abandonPayment(client, txn, payload.bookingId, payload.paymentId, reason);
    }
  });
}

/** Publishes the due messages of one database, one batch at a time. Returns how many it published. */
export async function processOutbox(database: string, options: ProcessOptions = {}): Promise<number> {
  const client = getClient(database);
  const gateway = options.gateway ?? httpGateway;
  const crashAfterPublish = options.crashAfterPublish ?? (() => false);
  let published = 0;

  for (;;) {
    const batch = await claim(client, new Date());
    for (const message of batch) {
      try {
        await publish(client, database, message, gateway, crashAfterPublish);
        published += 1;
      } catch (error) {
        // After a crash the claim stays in place. The message is due again when the lease ends.
        if (error instanceof SimulatedCrash) continue;
        await recordFailure(client, message, error);
      }
    }
    if (batch.length < BATCH_SIZE) return published;
  }
}

interface RelayRuntime {
  state: RelayState;
  timer?: ReturnType<typeof setTimeout>;
  chain: Promise<unknown>;
}

const globalKey = Symbol.for('camusbooking.relay');

function runtime(): RelayRuntime {
  const scope = globalThis as typeof globalThis & { [globalKey]?: RelayRuntime };
  scope[globalKey] ??= {
    state: { running: false, paused: false, crashAfterPublish: false, lastTickAt: null, lastError: null, published: 0 },
    chain: Promise.resolve(),
  };
  return scope[globalKey];
}

async function relayDatabases(): Promise<string[]> {
  const root = rootDatabase();
  try {
    const branches = await listBranches();
    return [...new Set([root, ...branches.map((branch) => branch.name).filter(Boolean)])];
  } catch {
    return [root];
  }
}

/** Runs one pass over every database. Passes never overlap, whether the loop or a caller starts them. */
export function drainOnce(): Promise<number> {
  const relay = runtime();
  const run = relay.chain.then(async () => {
    let published = 0;
    const errors: string[] = [];
    for (const database of await relayDatabases()) {
      try {
        published += await processOutbox(database, {
          crashAfterPublish: () => {
            if (!relay.state.crashAfterPublish) return false;
            relay.state.crashAfterPublish = false;
            return true;
          },
        });
      } catch (error) {
        errors.push(`${database}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    relay.state.lastTickAt = new Date().toISOString();
    relay.state.lastError = errors.length ? errors.join('; ') : null;
    relay.state.published += published;
    return published;
  });
  relay.chain = run.catch(() => undefined);
  return run;
}

function schedule(delay: number): void {
  const relay = runtime();
  if (relay.timer) clearTimeout(relay.timer);
  relay.timer = setTimeout(async () => {
    let published = 0;
    if (!relay.state.paused) {
      try {
        published = await drainOnce();
      } catch (error) {
        relay.state.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    schedule(published > 0 ? 0 : POLL_MS);
  }, delay);
  relay.timer.unref?.();
}

export function startRelay(): void {
  const relay = runtime();
  if (relay.state.running) return;
  relay.state.running = true;
  schedule(0);
}

/** Asks for a pass now instead of at the next poll, for example right after a booking commits. */
export function wakeRelay(): void {
  const relay = runtime();
  if (relay.state.running && !relay.state.paused) schedule(0);
}

export function relayState(): RelayState {
  return { ...runtime().state };
}

export function setRelayPaused(paused: boolean): RelayState {
  runtime().state.paused = paused;
  if (!paused) wakeRelay();
  return relayState();
}

/** Makes the next successful gateway call end like a relay crash, before the result is stored. */
export function armCrashAfterPublish(): RelayState {
  runtime().state.crashAfterPublish = true;
  return relayState();
}
