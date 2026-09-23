# CamusBooking

A Next.js flight-booking demo on **CamusDB** and the [`camusdb`](https://www.npmjs.com/package/camusdb) TypeScript connector. It holds fake airline inventory in serializable transactions, with idempotent PNRs, last-seat races, a transactional outbox that pays bookings through a simulated Stripe-like gateway, copy-on-write branches, time-travel reads, and recoverable drops.

<img width="995" height="869" alt="booking" src="https://github.com/user-attachments/assets/543c68e8-5b7e-4543-bf83-f46a808c5e71" />

## Prerequisites

- Node.js 20.11 or later
- CamusDB running locally (REST on **5095** by default)

```bash
# if CamusDB is not already running
dotnet tool install --global CamusDB.Server
camusdb
```

## Quick start

```bash
cp .env.example .env.local   # optional; defaults match a local node
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first boot the app creates the `camusbooking` database, applies schema, and seeds passengers (Maya, Noah, Elena) plus eight fake flights.

| Service | URL |
|---------|-----|
| Web app | http://localhost:3000 |
| CamusDB REST | http://localhost:5095 |

Set `CAMUS_ENDPOINT` if your node is not on `http://localhost:5095`.

## What it shows

1. **Book a seat** — decrement `seats_available`, insert a `pending_payment` booking, a `reserved` event, a payment row, and a `payment.requested` outbox message in one transaction.
2. **Pay** — the outbox relay sends the payment to the fake gateway; its signed webhook confirms the booking or releases the seats. See [Payments and the outbox](#payments-and-the-outbox).
3. **Retry safety** — reuse an idempotency key (or click **Retry 3×**). One PNR.
4. **Last-seat race** — in the lab, run 50 concurrent bookings against CM055 (2 seats). Expect 2 successes.
5. **Failure injection** — abort after the seat hold, before the outbox insert, or before commit; inventory, events, and outbox messages roll back.
6. **Payment failures** — in the lab, pause the relay, crash it after a gateway call, take the gateway down, or send every webhook twice.
7. **Branch** — `CREATE DATABASE what-if-inventory BRANCH FROM camusbooking`, switch with `X-Camus-Database`.
8. **Time machine** — `SELECT … AS OF SYSTEM TIME '-30s'`, then recover a dropped `flights` table with `RELINK`.

## Payments and the outbox

A booking does not call the payment gateway itself. It writes the payment request to the `outbox` table in the same transaction as the seat hold, so the request exists if and only if the hold committed. A relay then delivers it.

```
POST /api/bookings ──txn──▶ bookings (pending_payment) + payments (pending) + outbox (payment.requested)
relay ──▶ POST /api/gateway/v1/payment_intents   Idempotency-Key: <outbox id>
gateway ──▶ POST /api/webhooks/payments           Gateway-Signature: t=…,v1=<HMAC-SHA256>
webhook ──txn──▶ booking confirmed | payment_failed (seats released) + processed_webhooks
```

- **Relay** — runs in the Next.js server process, started from `src/instrumentation.ts`. It claims due messages with a 5 s lease, so a relay that dies loses its claim and another pass takes the message again. A failed call retries with exponential backoff; after 5 attempts, or on a request the gateway rejects, the message becomes `dead` and the booking's hold is released. It also drains every branch of the database.
- **Idempotency** — the outbox id is the gateway idempotency key, so a message sent twice (after a relay crash) creates one payment intent. The webhook handler stores each event id in `processed_webhooks` in the same transaction as its change, so a duplicate delivery changes nothing.
- **Fake gateway** — Stripe-shaped `payment_intents` and `refunds` endpoints under `/api/gateway/v1`, with Stripe test payment methods: `pm_card_visa` succeeds, `pm_card_chargeDeclined` and `pm_card_chargeDeclinedInsufficientFunds` fail. It keeps its state in memory, so a restart clears it. Webhooks that do not get a 2xx answer are sent again with backoff.
- **Refunds** — cancelling a paid booking writes a `refund.requested` message in the cancel transaction. A payment that succeeds after its hold ended (for example, after the relay gave up on a call the gateway did process) is refunded the same way. A booking whose payment is still in progress cannot be cancelled (409).

The **Payments and outbox** panel in the lab shows the outbox, the gateway's intents, and its webhook deliveries, with switches to pause or crash the relay and to break the gateway.

## Layout

```
src/
  app/            Next.js App Router pages and route handlers
  components/     Header, lab payments panel
  instrumentation.ts  Bootstraps CamusDB and starts the outbox relay
  lib/camus/      CamusClient factory, schema, seed, admin, demos
  lib/outbox/     Outbox writes and the relay
  lib/payments/   Fake gateway, its HTTP client, webhook signatures
  lib/services/   Booking and payment transactions
```

The UI talks to `/api/*`. Every mutating booking goes through `CamusClient.beginTransaction()` and `withRetry` from the connector.

## Configuration

`.env.local`:

```
CAMUS_ENDPOINT=http://localhost:5095
CAMUS_DATABASE=camusbooking
CAMUS_TIMEOUT=30
APP_URL=http://localhost:3000
PAYMENT_GATEWAY_SECRET_KEY=sk_test_camusbooking
PAYMENT_WEBHOOK_SECRET=whsec_camusbooking_demo
```

The relay and the gateway reach the app over HTTP at `APP_URL`. Set it if the app runs on another port.

Send `X-Camus-Database` (or switch in the lab) to pin a request to a branch.

## Tests

Integration tests skip if CamusDB is not reachable. They run against their own `camusbooking_test` database (override with `CAMUS_TEST_DATABASE`), so they do not use the demo's seats. The payment tests drive the relay with a stub gateway.

```bash
npm test
```
