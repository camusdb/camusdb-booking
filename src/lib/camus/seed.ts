import { CamusObjectId, camus, type CamusClient } from 'camusdb';
import { getClient } from './client';
import { listFlights, listPassengers } from '../services/booking';
import { recordEvent } from '../services/events';
import type { SeedSummary } from '../types';

/** The `app_metadata` key that marks a seeded database. */
const SEED_KEY = 'seeded_at';

const passengers = [
  { name: 'Maya Chen', email: 'maya.chen@example.com' },
  { name: 'Noah Okonkwo', email: 'noah.okonkwo@example.com' },
  { name: 'Elena Rossi', email: 'elena.rossi@example.com' },
];

interface SeedFlight {
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  departOffsetHours: number;
  durationHours: number;
  cabin: string;
  fare: number;
  seats: number;
}

const flights: SeedFlight[] = [
  { flightNumber: 'CM210', airline: 'Camus Air', origin: 'LIS', destination: 'JFK', departOffsetHours: 6, durationHours: 8, cabin: 'economy', fare: 642, seats: 18 },
  { flightNumber: 'CM211', airline: 'Camus Air', origin: 'JFK', destination: 'LIS', departOffsetHours: 30, durationHours: 7.5, cabin: 'economy', fare: 618, seats: 16 },
  { flightNumber: 'AN440', airline: 'Atlantic North', origin: 'LHR', destination: 'NRT', departOffsetHours: 11, durationHours: 12, cabin: 'premium', fare: 1280, seats: 8 },
  { flightNumber: 'PL118', airline: 'Pacific Loop', origin: 'SFO', destination: 'CDG', departOffsetHours: 14, durationHours: 11, cabin: 'economy', fare: 890, seats: 22 },
  { flightNumber: 'SL090', airline: 'Serra Lines', origin: 'GRU', destination: 'LIS', departOffsetHours: 9, durationHours: 9, cabin: 'economy', fare: 710, seats: 12 },
  { flightNumber: 'CM055', airline: 'Camus Air', origin: 'LIS', destination: 'CDG', departOffsetHours: 4, durationHours: 2.5, cabin: 'economy', fare: 164, seats: 2 },
  { flightNumber: 'AN902', airline: 'Atlantic North', origin: 'LHR', destination: 'JFK', departOffsetHours: 20, durationHours: 8, cabin: 'business', fare: 2140, seats: 6 },
  { flightNumber: 'PL330', airline: 'Pacific Loop', origin: 'NRT', destination: 'SFO', departOffsetHours: 26, durationHours: 9.5, cabin: 'economy', fare: 940, seats: 14 },
];

async function isSeeded(client: CamusClient): Promise<boolean> {
  const row = await client.queryOne<{ value: string }>('SELECT value FROM app_metadata WHERE meta_key = @key', {
    key: SEED_KEY,
  });
  return row !== undefined;
}

/** Inserts the passenger unless one with the same email is there. Returns its id. */
async function ensurePassenger(client: CamusClient, passenger: (typeof passengers)[number]): Promise<string> {
  const existing = await client.queryOne<{ id: string }>('SELECT id FROM passengers WHERE email = @email', {
    email: passenger.email,
  });
  if (existing) return existing.id;

  const id = CamusObjectId.generateAsString();
  await client.insert('passengers', { id: camus.id(id), name: passenger.name, email: passenger.email });
  return id;
}

/** Inserts the flight unless one with the same number is there. Returns its id. */
async function ensureFlight(client: CamusClient, flight: SeedFlight, now: number): Promise<string> {
  const existing = await client.queryOne<{ id: string }>('SELECT id FROM flights WHERE flight_number = @flightNumber', {
    flightNumber: flight.flightNumber,
  });
  if (existing) return existing.id;

  const id = CamusObjectId.generateAsString();
  const departsAt = new Date(now + flight.departOffsetHours * 3_600_000);
  const arrivesAt = new Date(departsAt.getTime() + flight.durationHours * 3_600_000);
  await client.insert('flights', {
    id: camus.id(id),
    flight_number: flight.flightNumber,
    airline: flight.airline,
    origin: flight.origin,
    destination: flight.destination,
    departs_at: departsAt,
    arrives_at: arrivesAt,
    cabin: flight.cabin,
    fare: camus.float64(flight.fare),
    seats_total: flight.seats,
    seats_available: flight.seats,
    status: 'scheduled',
    created_at: new Date(),
  });
  return id;
}

/** A confirmed booking from "before the demo", so the board is not empty on first boot. */
async function insertHistoricalBooking(client: CamusClient, passengerId: string, flightId: string, seats: number): Promise<void> {
  await client.transaction(async (txn) => {
    const flight = await client.queryOne<{ fare: number }>(
      'SELECT fare FROM flights WHERE id = @id',
      { id: camus.id(flightId) },
      { transaction: txn },
    );
    if (!flight) return;

    const bookingId = CamusObjectId.generateAsString();
    await client.execute(
      'UPDATE flights SET seats_available = seats_available - @seats WHERE id = @id',
      { seats, id: camus.id(flightId) },
      { transaction: txn },
    );
    await client.insert(
      'bookings',
      {
        id: camus.id(bookingId),
        passenger_id: camus.id(passengerId),
        flight_id: camus.id(flightId),
        seats,
        total: camus.float64(flight.fare * seats),
        status: 'confirmed',
        pnr: `SEED${seats}${crypto.randomUUID().slice(0, 2).toUpperCase()}`.slice(0, 6),
        idempotency_key: `seed-${bookingId}`,
        created_at: new Date(),
      },
      { transaction: txn },
    );
    await recordEvent(client, txn, { bookingId, flightId, eventType: 'reserved', seats });
  });
}

/**
 * Fills an empty database with demo data. Each step checks what is there first, so a seed that
 * stopped halfway continues on the next start. The `seeded_at` row marks the end.
 */
export async function seedIfNeeded(): Promise<void> {
  const client = getClient();
  if (await isSeeded(client)) return;

  const now = Date.now();
  const passengerIds: string[] = [];
  for (const passenger of passengers) passengerIds.push(await ensurePassenger(client, passenger));

  const flightIds: string[] = [];
  for (const flight of flights) flightIds.push(await ensureFlight(client, flight, now));

  const bookingCount = (await client.scalar<number>('SELECT COUNT(*) FROM bookings')) ?? 0;
  if (bookingCount === 0) {
    await insertHistoricalBooking(client, passengerIds[0]!, flightIds[0]!, 1);
    await insertHistoricalBooking(client, passengerIds[1]!, flightIds[4]!, 2);
  }

  try {
    await client.insert('app_metadata', { meta_key: SEED_KEY, value: new Date().toISOString() });
  } catch (error) {
    // Two processes seeded at the same time, and the other one wrote the marker first.
    if (!(await isSeeded(client))) throw error;
  }
}

export async function getSeedSummary(): Promise<SeedSummary> {
  const [passengerList, flightList, bookingCount] = await Promise.all([
    listPassengers(),
    listFlights(),
    getClient().scalar<number>('SELECT COUNT(*) FROM bookings'),
  ]);
  return { passengers: passengerList, flights: flightList, bookingCount: bookingCount ?? 0 };
}
