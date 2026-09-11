import { asNumber, toIso } from '../errors';
import type { Booking, BookingEvent, Flight, Passenger } from '../types';

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

export const flightSelect = `
  SELECT id, flight_number, airline, origin, destination, departs_at, arrives_at,
         cabin, fare, seats_total, seats_available, status, created_at
  FROM flights
`;

export const bookingSelect = `
  SELECT id, passenger_id, flight_id, seats, total, status, pnr, idempotency_key, created_at
  FROM bookings
`;
