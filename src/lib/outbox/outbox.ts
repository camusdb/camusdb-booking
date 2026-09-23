import { CamusObjectId, camus, type CamusClient, type CamusTransaction } from 'camusdb';
import { getClient } from '../camus/client';
import { mapOutbox, outboxSelect, type OutboxRow } from '../camus/map';
import type { OutboxMessage, OutboxTopic, PaymentMethod } from '../types';

export interface PaymentRequestedPayload {
  bookingId: string;
  paymentId: string;
  pnr: string;
  amountCents: number;
  currency: 'usd';
  paymentMethod: PaymentMethod;
}

export interface RefundRequestedPayload {
  bookingId: string;
  paymentId: string;
  intentId: string;
  amountCents: number;
}

export interface OutboxPayloads {
  'payment.requested': PaymentRequestedPayload;
  'refund.requested': RefundRequestedPayload;
}

/**
 * Writes a message to the outbox inside the caller's transaction. The message commits or rolls back
 * with the business change that produced it, so the relay never publishes a message for a change that
 * did not happen, and never misses one for a change that did.
 */
export async function enqueue<T extends OutboxTopic>(
  client: CamusClient,
  transaction: CamusTransaction,
  topic: T,
  aggregateId: string,
  payload: OutboxPayloads[T],
): Promise<string> {
  const id = CamusObjectId.generateAsString();
  const now = new Date();
  await client.insert(
    'outbox',
    {
      id: camus.id(id),
      aggregate_id: camus.id(aggregateId),
      topic,
      payload: JSON.stringify(payload),
      status: 'pending',
      attempts: 0,
      next_attempt_at: now,
      last_error: '',
      created_at: now,
      updated_at: now,
    },
    { transaction },
  );
  return id;
}

export async function listOutbox(limit = 20): Promise<OutboxMessage[]> {
  const take = Math.min(Math.max(limit, 1), 100);
  const { rows } = await getClient().query<OutboxRow>(`${outboxSelect} ORDER BY created_at DESC LIMIT ${take}`);
  return rows.map(mapOutbox);
}

export async function countOutbox(): Promise<number> {
  return Number((await getClient().scalar<number | bigint>('SELECT COUNT(*) FROM outbox')) ?? 0);
}
