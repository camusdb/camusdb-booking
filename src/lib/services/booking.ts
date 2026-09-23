import { CamusObjectId, camus, withRetry, type CamusClient, type CamusTransaction } from 'camusdb';
import { getClient } from '../camus/client';
import { maybeFail } from '../camus/context';
import { bookingSelect, flightSelect, mapBooking, mapFlight, mapPassenger, type BookingRow, type FlightRow, type PassengerRow } from '../camus/map';
import { HttpError, isUniqueViolation } from '../errors';
import { enqueue } from '../outbox/outbox';
import { wakeRelay } from '../outbox/relay';
import { paymentMethods } from '../payments/gateway';
import { findPayment } from './payments';
import type { Booking, BookingDetail, CreateBookingRequest, Flight, Passenger, PaymentMethod } from '../types';

const PNR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePnr(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => PNR_ALPHABET[byte % PNR_ALPHABET.length]).join('');
}

export async function listPassengers(): Promise<Passenger[]> {
  const { rows } = await getClient().query<PassengerRow>(
    'SELECT id, name, email FROM passengers ORDER BY name',
  );
  return rows.map(mapPassenger);
}

export async function listFlights(): Promise<Flight[]> {
  const { rows } = await getClient().query<FlightRow>(`${flightSelect} ORDER BY departs_at`);
  return rows.map(mapFlight);
}

export async function getFlight(id: string): Promise<Flight | undefined> {
  const row = await getClient().queryOne<FlightRow>(`${flightSelect} WHERE id = @id`, {
    id: camus.id(id),
  });
  return row ? mapFlight(row) : undefined;
}

export async function listBookings(flightId?: string): Promise<Booking[]> {
  const client = getClient();
  if (flightId) {
    const { rows } = await client.query<BookingRow>(
      `${bookingSelect} WHERE flight_id = @flightId ORDER BY created_at DESC`,
      { flightId: camus.id(flightId) },
    );
    return rows.map(mapBooking);
  }

  const { rows } = await client.query<BookingRow>(`${bookingSelect} ORDER BY created_at DESC`);
  return rows.map(mapBooking);
}

export async function getBooking(id: string): Promise<BookingDetail | undefined> {
  const client = getClient();
  const row = await client.queryOne<BookingRow>(`${bookingSelect} WHERE id = @id`, { id: camus.id(id) });
  if (!row) return undefined;
  return { ...mapBooking(row), payment: (await findPayment(client, id)) ?? null };
}

async function findByIdempotencyKey(
  client: CamusClient,
  key: string,
  transaction?: CamusTransaction,
): Promise<Booking | undefined> {
  const row = await client.queryOne<BookingRow>(
    `${bookingSelect} WHERE idempotency_key = @key`,
    { key },
    transaction ? { transaction } : undefined,
  );
  return row ? mapBooking(row) : undefined;
}

/**
 * Returns the booking that an earlier request with this key made. A key identifies one request, so a
 * key sent again with other parameters is refused instead of answered with a booking the caller did not
 * ask for. Seed bookings have no payment row, so their payment method is not compared.
 */
async function replayFor(
  client: CamusClient,
  request: CreateBookingRequest,
  paymentMethod: PaymentMethod,
  key: string,
  transaction?: CamusTransaction,
): Promise<Booking | undefined> {
  const existing = await findByIdempotencyKey(client, key, transaction);
  if (!existing) return undefined;

  const payment = await findPayment(client, existing.id, transaction);
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

  const existing = await replayFor(client, request, paymentMethod, idempotencyKey);
  if (existing) return existing;

  try {
    return await withRetry(async () => {
    await using txn = await client.beginTransaction();

    try {
      const replay = await replayFor(client, request, paymentMethod, idempotencyKey, txn);
      if (replay) {
        await txn.rollback();
        return replay;
      }

      const passenger = await client.queryOne<PassengerRow>(
        'SELECT id, name, email FROM passengers WHERE id = @id',
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

      const available = Number(flight.seats_available);
      maybeFail('afterRead');

      if (available < request.seats) {
        throw new HttpError(400, 'Not enough seats remaining.');
      }

      await client.execute(
        'UPDATE flights SET seats_available = @seats WHERE id = @id',
        { seats: available - request.seats, id: camus.id(flight.id) },
        { transaction: txn },
      );
      maybeFail('afterSeatHold');

      const bookingId = CamusObjectId.generateAsString();
      const now = new Date();
      const total = flight.fare * request.seats;
      const pnr = generatePnr();

      await client.insert(
        'bookings',
        {
          id: camus.id(bookingId),
          passenger_id: camus.id(request.passengerId),
          flight_id: camus.id(request.flightId),
          seats: request.seats,
          total: camus.float64(total),
          status: 'pending_payment',
          pnr,
          idempotency_key: idempotencyKey,
          created_at: now,
        },
        { transaction: txn },
      );

      const paymentId = CamusObjectId.generateAsString();
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

      await client.insert(
        'booking_events',
        {
          id: camus.id(CamusObjectId.generateAsString()),
          booking_id: camus.id(bookingId),
          flight_id: camus.id(request.flightId),
          event_type: 'reserved',
          seats: request.seats,
          created_at: now,
        },
        { transaction: txn },
      );
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

      await txn.commit();
      wakeRelay();
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
    } catch (error) {
      await txn.rollback();
      throw error;
    }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const booking = await replayFor(client, request, paymentMethod, idempotencyKey);
      if (booking) return booking;
    }
    throw error;
  }
}

export async function cancelBooking(id: string): Promise<Booking> {
  const client = getClient();
  return withRetry(async () => {
  await using txn = await client.beginTransaction();

  try {
    const booking = await client.queryOne<BookingRow>(
      `${bookingSelect} WHERE id = @id`,
      { id: camus.id(id) },
      { transaction: txn },
    );
    if (!booking) throw new HttpError(404, 'Booking not found.');
    if (booking.status === 'cancelled') throw new HttpError(400, 'Booking is already cancelled.');
    if (booking.status === 'pending_payment') {
      throw new HttpError(409, 'The payment for this booking is still in progress. Try again when it completes.');
    }
    if (booking.status !== 'confirmed') throw new HttpError(400, `A ${booking.status} booking cannot be cancelled.`);

    const flight = await client.queryOne<FlightRow>(
      `${flightSelect} WHERE id = @id`,
      { id: camus.id(booking.flight_id) },
      { transaction: txn },
    );
    if (!flight) throw new HttpError(404, 'Flight not found.');

    const seats = Number(booking.seats);
    await client.execute(
      "UPDATE bookings SET status = @status WHERE id = @id",
      { status: 'cancelled', id: camus.id(id) },
      { transaction: txn },
    );
    await client.execute(
      'UPDATE flights SET seats_available = @seats WHERE id = @id',
      { seats: Number(flight.seats_available) + seats, id: camus.id(flight.id) },
      { transaction: txn },
    );
    await client.insert(
      'booking_events',
      {
        id: camus.id(CamusObjectId.generateAsString()),
        booking_id: camus.id(id),
        flight_id: camus.id(flight.id),
        event_type: 'cancelled',
        seats,
        created_at: new Date(),
      },
      { transaction: txn },
    );

    // A paid booking gets its money back through the outbox, in the same transaction as the cancel.
    const payment = await findPayment(client, id, txn);
    const refunding = payment?.status === 'succeeded';
    if (payment && refunding) {
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

    await txn.commit();
    if (refunding) wakeRelay();
    return { ...mapBooking(booking), status: 'cancelled' };
  } catch (error) {
    await txn.rollback();
    throw error;
  }
  });
}
