import { afterAll, expect, it } from 'vitest';
import { CamusClient } from 'camusdb';
import { bootstrap } from '@/lib/camus/bootstrap';
import { createBooking, listFlights, listPassengers } from '@/lib/services/booking';

const endpoint = process.env.CAMUS_ENDPOINT || 'http://localhost:5095';

async function camusUp(): Promise<boolean> {
  try {
    const client = new CamusClient({ endpoint, database: 'camusbooking', timeoutSeconds: 3 });
    return await client.ping();
  } catch {
    return false;
  }
}

const available = await camusUp();

it('creates a booking and holds seats', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();

  const flights = await listFlights();
  const passengers = await listPassengers();
  const flight = flights.find((row) => row.flightNumber === 'CM211') ?? flights.at(-1);
  const passenger = passengers[0];
  expect(flight).toBeTruthy();
  expect(passenger).toBeTruthy();

  const before = flight!.seatsAvailable;
  const booking = await createBooking({
    flightId: flight!.id,
    passengerId: passenger!.id,
    seats: 1,
    idempotencyKey: `test-${Date.now()}`,
  });

  expect(booking.pnr).toHaveLength(6);
  expect(booking.status).toBe('pending_payment');

  const after = (await listFlights()).find((row) => row.id === flight!.id);
  expect(after?.seatsAvailable).toBe(before - 1);
});

it('replays the same idempotency key', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();

  const flights = await listFlights();
  const passengers = await listPassengers();
  const flight = flights.find((row) => row.seatsAvailable > 0);
  const key = `idem-${Date.now()}`;
  const first = await createBooking({
    flightId: flight!.id,
    passengerId: passengers[0]!.id,
    seats: 1,
    idempotencyKey: key,
  });
  const second = await createBooking({
    flightId: flight!.id,
    passengerId: passengers[0]!.id,
    seats: 1,
    idempotencyKey: key,
  });

  expect(second.id).toBe(first.id);
});

afterAll(() => undefined);
