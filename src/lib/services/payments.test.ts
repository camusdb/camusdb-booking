import { CamusClient, CamusObjectId, camus } from 'camusdb';
import { expect, it } from 'vitest';
import { bootstrap } from '@/lib/camus/bootstrap';
import { getClient, rootDatabase } from '@/lib/camus/client';
import { LEASE_MS, processOutbox } from '@/lib/outbox/relay';
import type { GatewayEvent, PaymentIntent, Refund } from '@/lib/payments/gateway';
import { GatewayRequestError, type PaymentGatewayClient } from '@/lib/payments/gateway-client';
import { cancelBooking, createBooking, getBooking, getFlight, listPassengers } from '@/lib/services/booking';
import { handleGatewayEvent } from '@/lib/services/payments';
import type { OutboxMessage } from '@/lib/types';
import { listOutbox } from '@/lib/outbox/outbox';

const endpoint = process.env.CAMUS_ENDPOINT || 'http://localhost:5095';

async function camusUp(): Promise<boolean> {
  try {
    return await new CamusClient({ endpoint, database: rootDatabase(), timeoutSeconds: 3 }).ping();
  } catch {
    return false;
  }
}

const available = await camusUp();

/** A gateway that answers at once and keeps one intent per idempotency key, as the real one does. */
function stubGateway(options: { reject?: boolean } = {}) {
  const intents = new Map<string, PaymentIntent>();
  const calls: string[] = [];
  const refunds: string[] = [];
  const gateway: PaymentGatewayClient = {
    async createPaymentIntent(params, key) {
      calls.push(key);
      if (options.reject) throw new GatewayRequestError('400 No such PaymentMethod', false);
      let intent = intents.get(key);
      if (!intent) {
        intent = {
          id: `pi_${key}`,
          object: 'payment_intent',
          amount: params.amount,
          amount_refunded: 0,
          currency: params.currency,
          status: 'processing',
          payment_method: params.payment_method,
          metadata: params.metadata ?? {},
          last_payment_error: null,
          created: 0,
        };
        intents.set(key, intent);
      }
      return intent;
    },
    async createRefund(params, key) {
      refunds.push(key);
      return { id: `re_${key}`, object: 'refund', amount: 0, payment_intent: params.payment_intent, status: 'succeeded', created: 0 } satisfies Refund;
    },
  };
  return { gateway, calls, refunds, intents };
}

function event(type: GatewayEvent['type'], intent: PaymentIntent): GatewayEvent {
  const failed = type === 'payment_intent.payment_failed';
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: 'event',
    type,
    created: 0,
    data: {
      object: {
        ...intent,
        status: failed ? 'requires_payment_method' : 'succeeded',
        last_payment_error: failed ? { code: 'card_declined', message: 'Your card was declined.' } : null,
      },
    },
  };
}

/** Each test gets its own flight, so runs never compete for seats. */
async function newFlight(seats: number): Promise<string> {
  const id = CamusObjectId.generateAsString();
  const departs = new Date(Date.now() + 86_400_000);
  await getClient().insert('flights', {
    id: camus.id(id),
    flight_number: `T${id.slice(-8)}`,
    airline: 'Test Air',
    origin: 'AAA',
    destination: 'BBB',
    departs_at: departs,
    arrives_at: new Date(departs.getTime() + 3_600_000),
    cabin: 'economy',
    fare: camus.float64(100),
    seats_total: seats,
    seats_available: seats,
    status: 'scheduled',
    created_at: new Date(),
  });
  return id;
}

async function book(flightId: string, seats = 1) {
  const passengers = await listPassengers();
  return createBooking({ flightId, passengerId: passengers[0]!.id, seats, idempotencyKey: `pay-${crypto.randomUUID()}` });
}

async function outboxFor(bookingId: string): Promise<OutboxMessage[]> {
  return (await listOutbox(100)).filter((message) => message.aggregateId === bookingId);
}

it('holds seats until the payment succeeds, and applies a duplicate webhook one time', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const flightId = await newFlight(3);

  const booking = await book(flightId, 2);
  expect(booking.status).toBe('pending_payment');
  expect((await getFlight(flightId))?.seatsAvailable).toBe(1);

  const [message] = await outboxFor(booking.id);
  expect(message).toMatchObject({ topic: 'payment.requested', status: 'pending' });

  const stub = stubGateway();
  await processOutbox(rootDatabase(), { gateway: stub.gateway });
  expect(stub.calls).toContain(message!.id);
  expect((await outboxFor(booking.id))[0]?.status).toBe('sent');

  const intent = stub.intents.get(message!.id)!;
  expect(intent.amount).toBe(20_000);
  expect((await getBooking(booking.id))?.payment?.intentId).toBe(intent.id);

  const succeeded = event('payment_intent.succeeded', intent);
  expect(await handleGatewayEvent(succeeded)).toMatchObject({ duplicate: false, bookingStatus: 'confirmed' });
  expect(await handleGatewayEvent(succeeded)).toEqual({ duplicate: true });

  const detail = await getBooking(booking.id);
  expect(detail?.status).toBe('confirmed');
  expect(detail?.payment?.status).toBe('succeeded');
  expect((await getFlight(flightId))?.seatsAvailable).toBe(1);
});

it('releases the seats when the card is declined', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const flightId = await newFlight(2);

  const booking = await book(flightId, 2);
  expect((await getFlight(flightId))?.seatsAvailable).toBe(0);

  const stub = stubGateway();
  await processOutbox(rootDatabase(), { gateway: stub.gateway });
  const [message] = await outboxFor(booking.id);
  await handleGatewayEvent(event('payment_intent.payment_failed', stub.intents.get(message!.id)!));

  const detail = await getBooking(booking.id);
  expect(detail?.status).toBe('payment_failed');
  expect(detail?.payment).toMatchObject({ status: 'failed', failureReason: 'card_declined' });
  expect((await getFlight(flightId))?.seatsAvailable).toBe(2);
});

it('sends the same idempotency key again after a crash between the gateway call and the commit', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const flightId = await newFlight(1);
  const booking = await book(flightId);
  const [message] = await outboxFor(booking.id);

  const stub = stubGateway();
  await processOutbox(rootDatabase(), { gateway: stub.gateway, crashAfterPublish: () => true });
  expect((await outboxFor(booking.id))[0]).toMatchObject({ status: 'pending', attempts: 1 });

  // The claim hides the message until its lease ends; then any relay can take it again.
  await processOutbox(rootDatabase(), { gateway: stub.gateway });
  expect(stub.calls.filter((key) => key === message!.id)).toHaveLength(1);

  await new Promise((resolve) => setTimeout(resolve, LEASE_MS + 250));
  await processOutbox(rootDatabase(), { gateway: stub.gateway });

  expect(stub.calls.filter((key) => key === message!.id)).toHaveLength(2);
  expect(new Set([...stub.intents.values()].filter((intent) => intent.metadata.booking_id === booking.id)).size).toBe(1);
  expect((await outboxFor(booking.id))[0]).toMatchObject({ status: 'sent', attempts: 2 });
});

it('moves a rejected request to dead and gives the seats back', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const flightId = await newFlight(1);
  const booking = await book(flightId);

  await processOutbox(rootDatabase(), { gateway: stubGateway({ reject: true }).gateway });

  expect((await outboxFor(booking.id))[0]?.status).toBe('dead');
  const detail = await getBooking(booking.id);
  expect(detail?.status).toBe('payment_failed');
  expect(detail?.payment?.status).toBe('failed');
  expect((await getFlight(flightId))?.seatsAvailable).toBe(1);
});

it('refunds a paid booking through the outbox when it is cancelled', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const flightId = await newFlight(1);
  const booking = await book(flightId);

  const stub = stubGateway();
  await processOutbox(rootDatabase(), { gateway: stub.gateway });
  const [message] = await outboxFor(booking.id);
  await handleGatewayEvent(event('payment_intent.succeeded', stub.intents.get(message!.id)!));

  await expect(cancelBooking(booking.id)).resolves.toMatchObject({ status: 'cancelled' });
  expect((await getBooking(booking.id))?.payment?.status).toBe('refund_pending');

  await processOutbox(rootDatabase(), { gateway: stub.gateway });
  const refund = (await outboxFor(booking.id)).find((row) => row.topic === 'refund.requested');
  expect(refund?.status).toBe('sent');
  expect(stub.refunds).toContain(refund!.id);
  expect((await getBooking(booking.id))?.payment?.status).toBe('refunded');
  expect((await getFlight(flightId))?.seatsAvailable).toBe(1);
});

it('refuses to cancel a booking while its payment is in progress', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const booking = await book(await newFlight(1));
  await expect(cancelBooking(booking.id)).rejects.toMatchObject({ status: 409 });
});

it('refuses an idempotency key sent again with another card', async ({ skip }) => {
  if (!available) skip();
  await bootstrap();
  const flightId = await newFlight(2);
  const passengerId = (await listPassengers())[0]!.id;
  const idempotencyKey = `card-${crypto.randomUUID()}`;

  const first = await createBooking({ flightId, passengerId, seats: 1, idempotencyKey, paymentMethod: 'pm_card_chargeDeclined' });
  const replay = await createBooking({ flightId, passengerId, seats: 1, idempotencyKey, paymentMethod: 'pm_card_chargeDeclined' });
  expect(replay.id).toBe(first.id);

  await expect(
    createBooking({ flightId, passengerId, seats: 1, idempotencyKey, paymentMethod: 'pm_card_visa' }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(createBooking({ flightId, passengerId, seats: 2, idempotencyKey, paymentMethod: 'pm_card_chargeDeclined' })).rejects.toMatchObject({
    status: 422,
  });
  expect((await getFlight(flightId))?.seatsAvailable).toBe(1);
});
