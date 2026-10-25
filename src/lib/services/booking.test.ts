import { describe, expect, it } from 'vitest';
import { bootstrap } from '@/lib/camus/bootstrap';
import { injectFailure, runConcurrentBookings } from '@/lib/camus/demo';
import { createBooking, getFlight, listFlights, listPassengers } from '@/lib/services/booking';
import { camusUp, newFlight } from '@/test/helpers';
import type { FailurePoint } from '@/lib/types';

const available = await camusUp();

async function firstPassengerId(): Promise<string> {
  return (await listPassengers())[0]!.id;
}

it('creates a booking and holds seats', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();

  const flights = await listFlights();
  const flight = flights.find((row) => row.flightNumber === 'CM211') ?? flights.at(-1);
  expect(flight).toBeTruthy();

  const before = flight!.seatsAvailable;
  const booking = await createBooking({
    flightId: flight!.id,
    passengerId: await firstPassengerId(),
    seats: 1,
    idempotencyKey: `test-${Date.now()}`,
  });

  expect(booking.pnr).toHaveLength(6);
  expect(booking.status).toBe('pending_payment');
  expect((await getFlight(flight!.id))?.seatsAvailable).toBe(before - 1);
});

it('replays the same idempotency key', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();

  const flightId = await newFlight(2);
  const passengerId = await firstPassengerId();
  const key = `idem-${Date.now()}`;
  const first = await createBooking({ flightId, passengerId, seats: 1, idempotencyKey: key });
  const second = await createBooking({ flightId, passengerId, seats: 1, idempotencyKey: key });

  expect(second.id).toBe(first.id);
  expect((await getFlight(flightId))?.seatsAvailable).toBe(1);
});

it('never sells more seats than the flight has', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();

  const flightId = await newFlight(2);
  const result = await runConcurrentBookings(flightId, await firstPassengerId(), 12);

  // A booking that loses a conflict more often than `client.transaction` retries it is rejected too,
  // so the test checks the invariant and not an exact count.
  expect(result.succeeded).toBeGreaterThan(0);
  expect(result.succeeded).toBeLessThanOrEqual(2);
  expect(result.seatsAfter).toBe(2 - result.succeeded);
});

describe('a failure inside the booking transaction rolls back every write', () => {
  const points: FailurePoint[] = ['afterRead', 'afterSeatHold', 'beforeEventInsert', 'beforeOutboxInsert', 'beforeCommit'];

  it.for(points)('%s', async (point, { skip }) => {
    if (!available) skip();
    await bootstrap();

    const flightId = await newFlight(3);
    const result = await injectFailure({ flightId, passengerId: await firstPassengerId(), seats: 1 }, point);

    expect(result).toEqual({ rolledBack: true, seatsBefore: 3, seatsAfter: 3, eventsCreated: 0, outboxCreated: 0 });
  });
});
