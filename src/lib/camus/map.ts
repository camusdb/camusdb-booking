import { asNumber, toIso } from '../errors';
import type { Booking, BookingEvent, Flight, OutboxMessage, Passenger, Payment } from '../types';

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
  departs_at: Date | string;
  arrives_at: Date | string;
  cabin: string;
  fare: number;
  seats_total: number | bigint;
  seats_available: number | bigint;
  status: string;
  created_at: Date | string;
}

export interface BookingRow {
  id: string;
  passenger_id: string;
  flight_id: string;
  seats: number | bigint;
  total: number;
  status: string;
  pnr: string;
  idempotency_key: string;
  created_at: Date | string;
}

export interface EventRow {
  id: string;
  booking_id: string | null;
  flight_id: string;
  event_type: string;
  seats: number | bigint;
  created_at: Date | string;
}

export interface PaymentRow {
  id: string;
  booking_id: string;
  intent_id: string;
  amount: number;
  payment_method: string;
  status: string;
  failure_reason: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface OutboxRow {
  id: string;
  aggregate_id: string;
  topic: string;
  payload: string;
  status: string;
  attempts: number | bigint;
  next_attempt_at: Date | string;
  last_error: string;
  created_at: Date | string;
  updated_at: Date | string;
}

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
    departsAt: toIso(row.departs_at),
    arrivesAt: toIso(row.arrives_at),
    cabin: row.cabin,
    fare: row.fare,
    seatsTotal: asNumber(row.seats_total),
    seatsAvailable: asNumber(row.seats_available),
    status: row.status as Flight['status'],
    createdAt: toIso(row.created_at),
  };
}

export function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    passengerId: row.passenger_id,
    flightId: row.flight_id,
    seats: asNumber(row.seats),
    total: row.total,
    status: row.status as Booking['status'],
    pnr: row.pnr,
    idempotencyKey: row.idempotency_key,
    createdAt: toIso(row.created_at),
  };
}

export function mapEvent(row: EventRow): BookingEvent {
  return {
    id: row.id,
    bookingId: row.booking_id,
    flightId: row.flight_id,
    eventType: row.event_type,
    seats: asNumber(row.seats),
    createdAt: toIso(row.created_at),
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
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapOutbox(row: OutboxRow): OutboxMessage {
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    topic: row.topic as OutboxMessage['topic'],
    payload: row.payload,
    status: row.status as OutboxMessage['status'],
    attempts: asNumber(row.attempts),
    nextAttemptAt: toIso(row.next_attempt_at),
    lastError: row.last_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export const flightSelect = `
  SELECT id, flight_number, airline, origin, destination, departs_at, arrives_at,
         cabin, fare, seats_total, seats_available, status, created_at
  FROM flights
`;

export const bookingSelect = `
  SELECT id, passenger_id, flight_id, seats, total, status, pnr, idempotency_key, created_at
  FROM bookings
`;

export const paymentSelect = `
  SELECT id, booking_id, intent_id, amount, payment_method, status, failure_reason, created_at, updated_at
  FROM payments
`;

export const outboxSelect = `
  SELECT id, aggregate_id, topic, payload, status, attempts, next_attempt_at, last_error, created_at, updated_at
  FROM outbox
`;
