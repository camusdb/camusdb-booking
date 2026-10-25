import type { Booking, BookingEvent, Flight, OutboxMessage, Passenger, Payment } from '../types';

/*
 * Two shapes for each table:
 *
 * - A `*Row` interface is one row as the driver returns it: snake_case column names, with the
 *   JavaScript type of each column type (OID and STRING → string, INT64 → number with the client's
 *   `int64: 'number'`, FLOAT64 → number, DATETIME → Date). Pass it as the type argument of
 *   `query<T>` and `queryOne<T>`. The driver does not check it against the schema, so keep the
 *   interface and the SELECT list next to each other.
 * - The model in `../types` is what the API sends to the browser: camelCase, with ISO date strings.
 *
 * A `map*` function converts the first shape into the second.
 */

export interface PassengerRow {
  id: string;
  name: string;
  email: string;
}

export interface FlightRow {
  id: string;
  flight_number: string;
  airline: string;
  origin: string;
  destination: string;
  departs_at: Date;
  arrives_at: Date;
  cabin: string;
  fare: number;
  seats_total: number;
  seats_available: number;
  status: string;
  created_at: Date;
}

export interface BookingRow {
  id: string;
  passenger_id: string;
  flight_id: string;
  seats: number;
  total: number;
  status: string;
  pnr: string;
  idempotency_key: string;
  created_at: Date;
}

export interface EventRow {
  id: string;
  booking_id: string | null;
  flight_id: string;
  event_type: string;
  seats: number;
  created_at: Date;
}

export interface PaymentRow {
  id: string;
  booking_id: string;
  intent_id: string;
  amount: number;
  payment_method: string;
  status: string;
  failure_reason: string;
  created_at: Date;
  updated_at: Date;
}

export interface OutboxRow {
  id: string;
  aggregate_id: string;
  topic: string;
  payload: string;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  last_error: string;
  created_at: Date;
  updated_at: Date;
}

export const passengerSelect = 'SELECT id, name, email FROM passengers';

export const flightSelect = `
  SELECT id, flight_number, airline, origin, destination, departs_at, arrives_at,
         cabin, fare, seats_total, seats_available, status, created_at
  FROM flights
`;

export const bookingSelect = `
  SELECT id, passenger_id, flight_id, seats, total, status, pnr, idempotency_key, created_at
  FROM bookings
`;

export const eventSelect = `
  SELECT id, booking_id, flight_id, event_type, seats, created_at
  FROM booking_events
`;

export const paymentSelect = `
  SELECT id, booking_id, intent_id, amount, payment_method, status, failure_reason, created_at, updated_at
  FROM payments
`;

export const outboxSelect = `
  SELECT id, aggregate_id, topic, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
  FROM outbox
`;

export function mapPassenger(row: PassengerRow): Passenger {
  return { id: row.id, name: row.name, email: row.email };
}

export function mapFlight(row: FlightRow): Flight {
  return {
    id: row.id,
    flightNumber: row.flight_number,
    airline: row.airline,
    origin: row.origin,
    destination: row.destination,
    departsAt: row.departs_at.toISOString(),
    arrivesAt: row.arrives_at.toISOString(),
    cabin: row.cabin,
    fare: row.fare,
    seatsTotal: row.seats_total,
    seatsAvailable: row.seats_available,
    status: row.status as Flight['status'],
    createdAt: row.created_at.toISOString(),
  };
}

export function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    passengerId: row.passenger_id,
    flightId: row.flight_id,
    seats: row.seats,
    total: row.total,
    status: row.status as Booking['status'],
    pnr: row.pnr,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
  };
}

export function mapEvent(row: EventRow): BookingEvent {
  return {
    id: row.id,
    bookingId: row.booking_id,
    flightId: row.flight_id,
    eventType: row.event_type,
    seats: row.seats,
    createdAt: row.created_at.toISOString(),
  };
}

export function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    bookingId: row.booking_id,
    intentId: row.intent_id,
    amount: row.amount,
    paymentMethod: row.payment_method as Payment['paymentMethod'],
    status: row.status as Payment['status'],
    failureReason: row.failure_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function mapOutbox(row: OutboxRow): OutboxMessage {
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    topic: row.topic as OutboxMessage['topic'],
    payload: row.payload,
    status: row.status as OutboxMessage['status'],
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
