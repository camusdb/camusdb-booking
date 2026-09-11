import { CamusObjectId, camus } from 'camusdb';
import { getClient } from '../camus/client';
import { mapFlight, mapPassenger, type FlightRow, type PassengerRow } from '../camus/map';
import type { SeedSummary } from '../types';

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

async function isSeeded(): Promise<boolean> {
  const row = await getClient().queryOne<{ value: string }>(
    'SELECT value FROM app_metadata WHERE meta_key = @key',
    { key: SEED_KEY },
  );
  return Boolean(row);
}

export async function seedIfNeeded(): Promise<void> {
  if (await isSeeded()) return;

  const client = getClient();
  const now = Date.now();
  const passengerIds: string[] = [];
  const flightIds: string[] = [];

  for (const passenger of passengers) {
    const existing = await client.queryOne<{ id: string }>(
      'SELECT id FROM passengers WHERE email = @email',
      { email: passenger.email },
    );
    if (existing) {
      passengerIds.push(existing.id);
      continue;
    }
    const id = CamusObjectId.generateAsString();
    passengerIds.push(id);
    await client.insert('passengers', {
      id: camus.id(id),
      name: passenger.name,
      email: passenger.email,
    });
  }

  for (const flight of flights) {
    const existing = await client.queryOne<{ id: string }>(
      'SELECT id FROM flights WHERE flight_number = @flightNumber',
      { flightNumber: flight.flightNumber },
    );
    if (existing) {
      flightIds.push(existing.id);
      continue;
    }
    const id = CamusObjectId.generateAsString();
    flightIds.push(id);
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
  }

  const existingBookings = Number((await client.scalar<number | bigint>('SELECT COUNT(*) FROM bookings')) ?? 0);
  if (existingBookings === 0) {
  const historical = [
    { passenger: passengerIds[0], flight: flightIds[0], seats: 1 },
    { passenger: passengerIds[1], flight: flightIds[4], seats: 2 },
  ];

  for (const item of historical) {
    const flight = await client.queryOne<FlightRow>(
      'SELECT id, fare, seats_available FROM flights WHERE id = @id',
      { id: camus.id(item.flight) },
    );
    if (!flight) continue;

    await using txn = await client.beginTransaction();
    try {
      const bookingId = CamusObjectId.generateAsString();
      await client.execute(
        'UPDATE flights SET seats_available = @seats WHERE id = @id',
        { seats: Number(flight.seats_available) - item.seats, id: camus.id(item.flight) },
        { transaction: txn },
      );
      await client.insert(
        'bookings',
        {
          id: camus.id(bookingId),
          passenger_id: camus.id(item.passenger),
          flight_id: camus.id(item.flight),
          seats: item.seats,
          total: camus.float64(flight.fare * item.seats),
          status: 'confirmed',
          pnr: `SEED${item.seats}${crypto.randomUUID().slice(0, 2).toUpperCase()}`.slice(0, 6),
          idempotency_key: `seed-${bookingId}`,
          created_at: new Date(),
        },
        { transaction: txn },
      );
      await client.insert(
        'booking_events',
        {
          id: camus.id(CamusObjectId.generateAsString()),
          booking_id: camus.id(bookingId),
          flight_id: camus.id(item.flight),
          event_type: 'reserved',
          seats: item.seats,
          created_at: new Date(),
        },
        { transaction: txn },
      );
      await txn.commit();
    } catch (error) {
      await txn.rollback();
      throw error;
    }
  }
  }

  const seeded = await client.queryOne<{ value: string }>(
    'SELECT value FROM app_metadata WHERE meta_key = @key',
    { key: SEED_KEY },
  );
  if (!seeded) {
    await client.insert('app_metadata', {
      meta_key: SEED_KEY,
      value: new Date().toISOString(),
    });
  }
}

export async function getSeedSummary(): Promise<SeedSummary> {
  const client = getClient();
  const passengersResult = await client.query<PassengerRow>('SELECT id, name, email FROM passengers ORDER BY name');
  const flightsResult = await client.query<FlightRow>(
    `SELECT id, flight_number, airline, origin, destination, departs_at, arrives_at,
            cabin, fare, seats_total, seats_available, status, created_at
     FROM flights ORDER BY departs_at`,
  );
  const bookingCount = (await client.scalar<number | bigint>('SELECT COUNT(*) FROM bookings')) ?? 0;

  return {
    passengers: passengersResult.rows.map(mapPassenger),
    flights: flightsResult.rows.map(mapFlight),
    bookingCount: Number(bookingCount),
  };
}
