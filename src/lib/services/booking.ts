import { CamusObjectId, camus, type CamusClient, type CamusTransaction } from 'camusdb';
import { getClient } from '../camus/client';
import { maybeFail } from '../camus/context';
import {
  bookingSelect,
  flightSelect,
  mapBooking,
  mapFlight,
  mapPassenger,
  passengerSelect,
  type BookingRow,
  type FlightRow,
  type PassengerRow,
} from '../camus/map';
import { HttpError, isUniqueViolation } from '../errors';
import { enqueue } from '../outbox/outbox';
import { wakeRelay } from '../outbox/relay';
import { paymentMethods } from '../payments/gateway';
import { recordEvent } from './events';
import { findPayment } from './payments';
import type { Booking, BookingDetail, CreateBookingRequest, Flight, Passenger, PaymentMethod } from '../types';

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePnr(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PNR_ALPHABET[byte % PNR_ALPHABET.length]).join('');
}

// ─── Reads ───────────────────────────────────────────────────────────────────
//
// A statement without a `transaction` option runs in its own short transaction (autocommit).

export async function listPassengers(): Promise<Passenger[]> {
  const { rows } = await getClient().query<PassengerRow>(`${passengerSelect} ORDER BY name`);
  return rows.map(mapPassenger);
}

export async function listFlights(): Promise<Flight[]> {
  const { rows } = await getClient().query<FlightRow>(`${flightSelect} ORDER BY departs_at`);
  return rows.map(mapFlight);
}

export async function getFlight(id: string): Promise<Flight | undefined> {
  // `camus.id` binds the string as an ObjectId. A plain string would bind as STRING, which never
  // equals an OID column.
  const row = await getClient().queryOne<FlightRow>(`${flightSelect} WHERE id = @id`, { id: camus.id(id) });
  return row ? mapFlight(row) : undefined;
}

export async function listBookings(flightId?: string): Promise<Booking[]> {
  const client = getClient();
  const { rows } = flightId
    ? await client.query<BookingRow>(`${bookingSelect} WHERE flight_id = @flightId ORDER BY created_at DESC`, {
        flightId: camus.id(flightId),
      })
    : await client.query<BookingRow>(`${bookingSelect} ORDER BY created_at DESC`);
  return rows.map(mapBooking);
}

export async function getBooking(id: string): Promise<BookingDetail | undefined> {
  const client = getClient();
  const row = await client.queryOne<BookingRow>(`${bookingSelect} WHERE id = @id`, { id: camus.id(id) });
  if (!row) return undefined;
  return { ...mapBooking(row), payment: (await findPayment(client, id)) ?? null };
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Returns the booking that an earlier request with this key made. A key identifies one request, so a
 * key sent again with other parameters is refused instead of answered with a booking the caller did not
 * ask for. Seed bookings have no payment row, so their payment method is not compared.
 *
 * With `txn`, the reads run inside that transaction. Without it, each read runs on its own.
 */
async function replayFor(
  client: CamusClient,
  request: CreateBookingRequest,
  paymentMethod: PaymentMethod,
  key: string,
  txn?: CamusTransaction,
): Promise<Booking | undefined> {
  const row = await client.queryOne<BookingRow>(
    `${bookingSelect} WHERE idempotency_key = @key`,
    { key },
    { transaction: txn },
  );
  if (!row) return undefined;

  const existing = mapBooking(row);
  const payment = await findPayment(client, existing.id, txn);
  const same =
    existing.passengerId === request.passengerId &&
    existing.flightId === request.flightId &&
    existing.seats === request.seats &&
    (!payment || payment.paymentMethod === paymentMethod);
  if (!same) {
    throw new HttpError(
      422,
      `Idempotency key ${key} was already used for a different booking request (PNR ${existing.pnr}). Use a new key.`,
    );
  }
  return existing;
}

/**
 * Holds seats on a flight and asks for the payment, in one serializable transaction:
 *
 * 1. Read the passenger and the flight, and check the seats.
 * 2. Take the seats from the flight.
 * 3. Insert the booking (`pending_payment`), its payment row, and a `reserved` event.
 * 4. Insert a `payment.requested` outbox message. The relay sends it to the gateway after the commit.
 *
 * Every step commits, or none does. The lab's failure points (`maybeFail`) throw between the steps to
 * show it.
 */
export async function createBooking(request: CreateBookingRequest): Promise<Booking> {
  if (!Number.isInteger(request.seats) || request.seats <= 0) {
    throw new HttpError(400, 'Seat count must be a positive integer.');
  }
  const paymentMethod = request.paymentMethod ?? 'pm_card_visa';
  if (!paymentMethods.includes(paymentMethod)) {
    throw new HttpError(400, `Unknown payment method ${paymentMethod}.`);
  }

  const idempotencyKey = request.idempotencyKey?.trim() || crypto.randomUUID().replaceAll('-', '');
  const client = getClient();

  // A retry of a request that already committed gets its booking back without a transaction.
  const existing = await replayFor(client, request, paymentMethod, idempotencyKey);
  if (existing) return existing;

  let booking: Booking;
  try {
    // `client.transaction` begins a transaction, runs the function, and commits. If the function
    // throws, it rolls back. If the commit loses a conflict to a concurrent booking, it runs the
    // whole function again on a new transaction. So the function only reads and writes the
    // database: a side effect here (an HTTP call, `wakeRelay`) could happen more than one time.
    booking = await client.transaction(async (txn) => {
      // Look again inside the transaction: a request with the same key can commit after the check above.
      const replay = await replayFor(client, request, paymentMethod, idempotencyKey, txn);
      if (replay) return replay;

      const passenger = await client.queryOne<PassengerRow>(
        `${passengerSelect} WHERE id = @id`,
        { id: camus.id(request.passengerId) },
        { transaction: txn },
      );
      if (!passenger) throw new HttpError(404, 'Passenger not found.');

      const flight = await client.queryOne<FlightRow>(
        `${flightSelect} WHERE id = @id`,
        { id: camus.id(request.flightId) },
        { transaction: txn },
      );
      if (!flight) throw new HttpError(404, 'Flight not found.');
      if (flight.status !== 'scheduled' && flight.status !== 'boarding') {
        throw new HttpError(400, 'Flight is not open for booking.');
      }
      maybeFail('afterRead');

      // The transaction is serializable, so no other transaction can change this count before the
      // commit. Two bookings that race for the last seat conflict, and the retry of the loser reads
      // the new count.
      if (flight.seats_available < request.seats) {
        throw new HttpError(400, 'Not enough seats remaining.');
      }

      await client.execute(
        'UPDATE flights SET seats_available = seats_available - @seats WHERE id = @id',
        { seats: request.seats, id: camus.id(flight.id) },
        { transaction: txn },
      );
      maybeFail('afterSeatHold');

      const bookingId = CamusObjectId.generateAsString();
      const paymentId = CamusObjectId.generateAsString();
      const now = new Date();
      const total = flight.fare * request.seats;
      const pnr = generatePnr();

      // `insert` writes one row from a column-to-value map, with no SQL text to compose.
      await client.insert(
        'bookings',
        {
          id: camus.id(bookingId),
          passenger_id: camus.id(request.passengerId),
          flight_id: camus.id(request.flightId),
          seats: request.seats,
          // A whole number such as 642 binds as INT64. `camus.float64` states the column's type.
          total: camus.float64(total),
          status: 'pending_payment',
          pnr,
          idempotency_key: idempotencyKey,
          created_at: now,
        },
        { transaction: txn },
      );

      await client.insert(
        'payments',
        {
          id: camus.id(paymentId),
          booking_id: camus.id(bookingId),
          intent_id: '',
          amount: camus.float64(total),
          payment_method: paymentMethod,
          status: 'pending',
          failure_reason: '',
          created_at: now,
          updated_at: now,
        },
        { transaction: txn },
      );
      maybeFail('beforeEventInsert');

      await recordEvent(client, txn, { bookingId, flightId: request.flightId, eventType: 'reserved', seats: request.seats });
      maybeFail('beforeOutboxInsert');

      await enqueue(client, txn, 'payment.requested', bookingId, {
        bookingId,
        paymentId,
        pnr,
        amountCents: Math.round(total * 100),
        currency: 'usd',
        paymentMethod,
      });
      maybeFail('beforeCommit');

      return {
        id: bookingId,
        passengerId: request.passengerId,
        flightId: request.flightId,
        seats: request.seats,
        total,
        status: 'pending_payment',
        pnr,
        idempotencyKey,
        createdAt: now.toISOString(),
      };
    });
  } catch (error) {
    // Two requests with one key both found no booking, and the unique index refused the second
    // insert. The first one committed, so answer with its booking.
    if (isUniqueViolation(error)) {
      const replay = await replayFor(client, request, paymentMethod, idempotencyKey);
      if (replay) return replay;
    }
    throw error;
  }

  // The outbox message is committed now, so the relay can send it.
  wakeRelay();
  return booking;
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

/** Cancels a confirmed booking, gives its seats back, and asks for a refund in the same transaction. */
export async function cancelBooking(id: string): Promise<Booking> {
  const client = getClient();

  const { booking, refunding } = await client.transaction(async (txn) => {
    const row = await client.queryOne<BookingRow>(
      `${bookingSelect} WHERE id = @id`,
      { id: camus.id(id) },
      { transaction: txn },
    );
    if (!row) throw new HttpError(404, 'Booking not found.');
    if (row.status === 'cancelled') throw new HttpError(400, 'Booking is already cancelled.');
    if (row.status === 'pending_payment') {
      throw new HttpError(409, 'The payment for this booking is still in progress. Try again when it completes.');
    }
    if (row.status !== 'confirmed') throw new HttpError(400, `A ${row.status} booking cannot be cancelled.`);

    await client.execute(
      'UPDATE bookings SET status = @status WHERE id = @id',
      { status: 'cancelled', id: camus.id(id) },
      { transaction: txn },
    );
    await client.execute(
      'UPDATE flights SET seats_available = seats_available + @seats WHERE id = @id',
      { seats: row.seats, id: camus.id(row.flight_id) },
      { transaction: txn },
    );
    await recordEvent(client, txn, { bookingId: id, flightId: row.flight_id, eventType: 'cancelled', seats: row.seats });

    // A paid booking gets its money back through the outbox, in the same transaction as the cancel.
    const payment = await findPayment(client, id, txn);
    if (payment?.status === 'succeeded') {
      await client.execute(
        'UPDATE payments SET status = @status, updated_at = @now WHERE id = @id',
        { status: 'refund_pending', now: new Date(), id: camus.id(payment.id) },
        { transaction: txn },
      );
      await enqueue(client, txn, 'refund.requested', id, {
        bookingId: id,
        paymentId: payment.id,
        intentId: payment.intentId,
        amountCents: Math.round(payment.amount * 100),
      });
    }

    return { booking: { ...mapBooking(row), status: 'cancelled' as const }, refunding: payment?.status === 'succeeded' };
  });

  if (refunding) wakeRelay();
  return booking;
}
