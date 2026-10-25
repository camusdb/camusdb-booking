import { camus, type CamusClient, type CamusTransaction } from 'camusdb';
import { getClient } from '../camus/client';
import { bookingSelect, mapPayment, paymentSelect, type BookingRow, type PaymentRow } from '../camus/map';
import { isUniqueViolation } from '../errors';
import { enqueue } from '../outbox/outbox';
import type { GatewayEvent } from '../payments/gateway';
import type { Payment } from '../types';
import { recordEvent } from './events';

/** With `txn`, the read runs inside that transaction. Without it, the read runs on its own. */
export async function findPayment(
  client: CamusClient,
  bookingId: string,
  txn?: CamusTransaction,
): Promise<Payment | undefined> {
  const row = await client.queryOne<PaymentRow>(
    `${paymentSelect} WHERE booking_id = @bookingId`,
    { bookingId: camus.id(bookingId) },
    { transaction: txn },
  );
  return row ? mapPayment(row) : undefined;
}

async function loadBooking(client: CamusClient, txn: CamusTransaction, id: string): Promise<BookingRow | undefined> {
  return client.queryOne<BookingRow>(`${bookingSelect} WHERE id = @id`, { id: camus.id(id) }, { transaction: txn });
}

function bookingEvent(booking: BookingRow, eventType: string) {
  return { bookingId: booking.id, flightId: booking.flight_id, eventType, seats: booking.seats };
}

/**
 * Sets a payment's status, and its intent id and failure reason when they are given. A field left out
 * binds as NULL, and `COALESCE` keeps the stored value. So the SQL text is the same for every call,
 * and the driver prepares it once.
 */
async function updatePayment(
  client: CamusClient,
  txn: CamusTransaction,
  paymentId: string,
  fields: { status: Payment['status']; intentId?: string; failureReason?: string },
): Promise<void> {
  await client.execute(
    `UPDATE payments
     SET status = @status,
         intent_id = COALESCE(@intentId, intent_id),
         failure_reason = COALESCE(@failureReason, failure_reason),
         updated_at = @now
     WHERE id = @id`,
    {
      status: fields.status,
      intentId: fields.intentId ?? null,
      failureReason: fields.failureReason ?? null,
      now: new Date(),
      id: camus.id(paymentId),
    },
    { transaction: txn },
  );
}

/**
 * Ends a seat hold whose payment failed: the booking becomes `payment_failed` and its seats return to
 * the flight. The caller checks that the booking is still `pending_payment`.
 */
async function releaseHold(client: CamusClient, txn: CamusTransaction, booking: BookingRow): Promise<void> {
  await client.execute(
    'UPDATE bookings SET status = @status WHERE id = @id',
    { status: 'payment_failed', id: camus.id(booking.id) },
    { transaction: txn },
  );
  await client.execute(
    'UPDATE flights SET seats_available = seats_available + @seats WHERE id = @id',
    { seats: booking.seats, id: camus.id(booking.flight_id) },
    { transaction: txn },
  );
  await recordEvent(client, txn, bookingEvent(booking, 'payment_failed'));
}

export interface WebhookResult {
  duplicate: boolean;
  bookingStatus?: string;
  paymentStatus?: Payment['status'];
}

/**
 * Applies one gateway event. The event id goes into `processed_webhooks` in the same transaction as
 * the change, so a second delivery of the same event changes nothing: it finds the id, or it loses the
 * race on the primary key and rolls back.
 */
export async function handleGatewayEvent(event: GatewayEvent): Promise<WebhookResult> {
  const client = getClient();
  const intent = event.data.object;
  const bookingId = intent.metadata.booking_id;
  if (!bookingId) return { duplicate: false };

  try {
    return await client.transaction(async (txn): Promise<WebhookResult> => {
      const seen = await client.queryOne<{ event_id: string }>(
        'SELECT event_id FROM processed_webhooks WHERE event_id = @id',
        { id: event.id },
        { transaction: txn },
      );
      if (seen) return { duplicate: true };

      const booking = await loadBooking(client, txn, bookingId);
      const payment = await findPayment(client, bookingId, txn);
      const result: WebhookResult = { duplicate: false, bookingStatus: booking?.status, paymentStatus: payment?.status };

      if (booking && payment) {
        if (event.type === 'payment_intent.succeeded') {
          if (booking.status === 'pending_payment') {
            await client.execute(
              'UPDATE bookings SET status = @status WHERE id = @id',
              { status: 'confirmed', id: camus.id(booking.id) },
              { transaction: txn },
            );
            await updatePayment(client, txn, payment.id, { status: 'succeeded', intentId: intent.id });
            await recordEvent(client, txn, bookingEvent(booking, 'payment_captured'));
            result.bookingStatus = 'confirmed';
            result.paymentStatus = 'succeeded';
          } else if (payment.status !== 'refund_pending' && payment.status !== 'refunded') {
            // The money arrived after the hold ended, for example after the relay gave up on a call
            // that the gateway did process. The seats are gone, so the charge goes back.
            await updatePayment(client, txn, payment.id, { status: 'refund_pending', intentId: intent.id });
            await enqueue(client, txn, 'refund.requested', booking.id, {
              bookingId: booking.id,
              paymentId: payment.id,
              intentId: intent.id,
              amountCents: intent.amount,
            });
            await recordEvent(client, txn, bookingEvent(booking, 'refund_requested'));
            result.paymentStatus = 'refund_pending';
          }
        } else if (event.type === 'payment_intent.payment_failed') {
          const reason = intent.last_payment_error?.code ?? 'payment_failed';
          if (booking.status === 'pending_payment') {
            await releaseHold(client, txn, booking);
            result.bookingStatus = 'payment_failed';
          }
          if (payment.status === 'pending') {
            await updatePayment(client, txn, payment.id, { status: 'failed', intentId: intent.id, failureReason: reason });
            result.paymentStatus = 'failed';
          }
        }
      }

      await client.insert(
        'processed_webhooks',
        { event_id: event.id, event_type: event.type, received_at: new Date() },
        { transaction: txn },
      );
      return result;
    });
  } catch (error) {
    // A concurrent delivery of the same event committed first, and its primary key refused this insert.
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }
}

/** Stores the intent id that the gateway returned for a payment request. */
export async function attachIntent(
  client: CamusClient,
  txn: CamusTransaction,
  paymentId: string,
  intentId: string,
): Promise<void> {
  await client.execute(
    'UPDATE payments SET intent_id = @intentId, updated_at = @now WHERE id = @id',
    { intentId, now: new Date(), id: camus.id(paymentId) },
    { transaction: txn },
  );
}

/**
 * The relay gave up on a payment request. A booking that still waits for its payment loses its hold.
 * If the gateway did take the payment, its webhook arrives later and starts a refund.
 */
export async function abandonPayment(
  client: CamusClient,
  txn: CamusTransaction,
  bookingId: string,
  paymentId: string,
  reason: string,
): Promise<void> {
  const booking = await loadBooking(client, txn, bookingId);
  if (booking?.status === 'pending_payment') await releaseHold(client, txn, booking);

  const payment = await findPayment(client, bookingId, txn);
  if (payment?.status === 'pending') {
    await updatePayment(client, txn, paymentId, { status: 'failed', failureReason: reason.slice(0, 200) });
  }
}

export async function completeRefund(
  client: CamusClient,
  txn: CamusTransaction,
  bookingId: string,
  paymentId: string,
): Promise<void> {
  await updatePayment(client, txn, paymentId, { status: 'refunded' });
  const booking = await loadBooking(client, txn, bookingId);
  if (booking) await recordEvent(client, txn, bookingEvent(booking, 'refunded'));
}
