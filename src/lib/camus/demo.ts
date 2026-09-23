import { getClient } from './client';
import { getStore, runWithStore } from './context';
import { HttpError } from '../errors';
import { countOutbox } from '../outbox/outbox';
import { createBooking, getFlight } from '../services/booking';
import type {
  ConcurrentDemoResult,
  CreateBookingRequest,
  FailureInjectionResult,
  FailurePoint,
  IdempotencyDemoResult,
} from '../types';

export async function runConcurrentBookings(
  flightId: string,
  passengerId: string,
  concurrency: number,
): Promise<ConcurrentDemoResult> {
  const before = await getFlight(flightId);
  if (!before) throw new HttpError(404, 'Flight not found.');

  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      createBooking({
        flightId,
        passengerId,
        seats: 1,
        idempotencyKey: `concurrent-${flightId}-${index}-${Date.now()}`,
      })
        .then(() => true)
        .catch(() => false),
    ),
  );

  const succeeded = results.filter(Boolean).length;
  const after = await getFlight(flightId);

  return {
    attempted: results.length,
    succeeded,
    rejected: results.length - succeeded,
    seatsBefore: before.seatsAvailable,
    seatsAfter: after?.seatsAvailable ?? 0,
  };
}

export async function runIdempotencyDemo(
  request: CreateBookingRequest,
  requestCount = 3,
): Promise<IdempotencyDemoResult> {
  const idempotencyKey = request.idempotencyKey || crypto.randomUUID().replaceAll('-', '');
  const bookings = await Promise.all(
    Array.from({ length: requestCount }, () => createBooking({ ...request, idempotencyKey })),
  );
  const distinct = new Set(bookings.map((booking) => booking.id)).size;
  return { requests: requestCount, bookings: distinct, booking: bookings[0] };
}

export async function injectFailure(
  request: CreateBookingRequest,
  failurePoint: FailurePoint,
): Promise<FailureInjectionResult> {
  const before = await getFlight(request.flightId);
  if (!before) throw new HttpError(404, 'Flight not found.');
  const eventsBefore = Number((await getClient().scalar<number | bigint>('SELECT COUNT(*) FROM booking_events')) ?? 0);
  const outboxBefore = await countOutbox();

  let rolledBack = false;
  try {
    await runWithStore({ ...getStore(), failure: failurePoint }, () => createBooking(request));
  } catch {
    rolledBack = true;
  }

  const after = await getFlight(request.flightId);
  const eventsAfter = Number((await getClient().scalar<number | bigint>('SELECT COUNT(*) FROM booking_events')) ?? 0);
  const outboxAfter = await countOutbox();

  return {
    rolledBack,
    seatsBefore: before.seatsAvailable,
    seatsAfter: after?.seatsAvailable ?? 0,
    eventsCreated: eventsAfter - eventsBefore,
    outboxCreated: outboxAfter - outboxBefore,
  };
}
