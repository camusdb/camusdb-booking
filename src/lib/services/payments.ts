import { CamusObjectId, camus, withRetry, type CamusClient, type CamusTransaction } from 'camusdb';
import { getClient } from '../camus/client';
import { bookingSelect, flightSelect, mapPayment, paymentSelect, type BookingRow, type FlightRow, type PaymentRow } from '../camus/map';
import { isUniqueViolation } from '../errors';
import { enqueue } from '../outbox/outbox';
import type { GatewayEvent } from '../payments/gateway';
import type { Payment } from '../types';

export async function findPayment(
  client: CamusClient,
  bookingId: string,
  transaction?: CamusTransaction,
): Promise<Payment | undefined> {
  const row = await client.queryOne<PaymentRow>(
    `${paymentSelect} WHERE booking_id = @bookingId`,
    { bookingId: camus.id(bookingId) },
    transaction ? { transaction } : undefined,
  );
  return row ? mapPayment(row) : undefined;
}

async function recordEvent(
  client: CamusClient,
  transaction: CamusTransaction,
  booking: BookingRow,
  eventType: string,
): Promise<void> {
  await client.insert(
    'booking_events',
    {
      id: camus.id(CamusObjectId.generateAsString()),
      booking_id: camus.id(booking.id),
      flight_id: camus.id(booking.flight_id),
      event_type: eventType,
      seats: Number(booking.seats),
      created_at: new Date(),
    },
    { transaction },
  );
}

async function updatePayment(
  client: CamusClient,
  transaction: CamusTransaction,
  paymentId: string,
  fields: { status: Payment['status']; intentId?: string; failureReason?: string },
): Promise<void> {
  const sets = ['status = @status', 'updated_at = @now'];
  const params: Record<string, unknown> = { status: fields.status, now: new Date(), id: camus.id(paymentId) };
  if (fields.intentId !== undefined) {
    sets.push('intent_id = @intentId');
    params.intentId = fields.intentId;
  }
  if (fields.failureReason !== undefined) {
    sets.push('failure_reason = @failureReason');
    params.failureReason = fields.failureReason;
  }
  await client.execute(`UPDATE payments SET ${sets.join(', ')} WHERE id = @id`, params, { transaction });
}

/**
 * Ends a seat hold whose payment failed: the booking becomes `payment_failed` and its seats return to
 * the flight. The caller checks that the booking is still `pending_payment`.
 */
async function releaseHold(client: CamusClient, transaction: CamusTransaction, booking: BookingRow): Promise<void> {
  const flight = await client.queryOne<FlightRow>(
    `${flightSelect} WHERE id = @id`,
    { id: camus.id(booking.flight_id) },
    { transaction },
  );
  await client.execute(
    'UPDATE bookings SET status = @status WHERE id = @id',
    { status: 'payment_failed', id: camus.id(booking.id) },
    { transaction },
  );
  if (flight) {
    await client.execute(
      'UPDATE flights SET seats_available = @seats WHERE id = @id',
      { seats: Number(flight.seats_available) + Number(booking.seats), id: camus.id(flight.id) },
      { transaction },
    );
  }
  await recordEvent(client, transaction, booking, 'payment_failed');
}

async function loadBooking(client: CamusClient, transaction: CamusTransaction, id: string): Promise<BookingRow | undefined> {
  return client.queryOne<BookingRow>(`${bookingSelect} WHERE id = @id`, { id: camus.id(id) }, { transaction });
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
    return await withRetry(async () => {
      await using txn = await client.beginTransaction();
      try {
        const seen = await client.queryOne<{ event_id: string }>(
          'SELECT event_id FROM processed_webhooks WHERE event_id = @id',
          { id: event.id },
          { transaction: txn },
        );
        if (seen) {
          await txn.rollback();
          return { duplicate: true };
        }

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
              await recordEvent(client, txn, booking, 'payment_captured');
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
              await recordEvent(client, txn, booking, 'refund_requested');
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
        await txn.commit();
        return result;
      } catch (error) {
        await txn.rollback();
        throw error;
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { duplicate: true };
    throw error;
  }
}

/** Stores the intent id that the gateway returned for a payment request. */
export async function attachIntent(
  client: CamusClient,
  transaction: CamusTransaction,
  paymentId: string,
  intentId: string,
): Promise<void> {
  await client.execute(
    'UPDATE payments SET intent_id = @intentId, updated_at = @now WHERE id = @id',
    { intentId, now: new Date(), id: camus.id(paymentId) },
    { transaction },
  );
}

/**
 * The relay gave up on a payment request. A booking that still waits for its payment loses its hold.
 * If the gateway did take the payment, its webhook arrives later and starts a refund.
 */
export async function abandonPayment(
  client: CamusClient,
  transaction: CamusTransaction,
  bookingId: string,
  paymentId: string,
  reason: string,
): Promise<void> {
  const booking = await loadBooking(client, transaction, bookingId);
  if (booking?.status === 'pending_payment') await releaseHold(client, transaction, booking);

  const payment = await findPayment(client, bookingId, transaction);
  if (payment?.status === 'pending') {
    await updatePayment(client, transaction, paymentId, { status: 'failed', failureReason: reason.slice(0, 200) });
  }
}

export async function completeRefund(
  client: CamusClient,
  transaction: CamusTransaction,
  bookingId: string,
  paymentId: string,
): Promise<void> {
  await updatePayment(client, transaction, paymentId, { status: 'refunded' });
  const booking = await loadBooking(client, transaction, bookingId);
  if (booking) await recordEvent(client, transaction, booking, 'refunded');
}
