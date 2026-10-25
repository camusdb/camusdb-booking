# CamusBooking

A Next.js flight-booking demo on **CamusDB** and the [`camusdb`](https://www.npmjs.com/package/camusdb) TypeScript connector. It holds fake airline inventory in serializable transactions, with idempotent PNRs, last-seat races, a transactional outbox that pays bookings through a simulated Stripe-like gateway, copy-on-write branches, time-travel reads, and recoverable drops.

It is also a sample of how to use CamusDB from TypeScript. [Learn CamusDB from this code](#learn-camusdb-from-this-code) walks through the patterns, with the file that shows each one.

<img width="995" height="869" alt="booking" src="https://github.com/user-attachments/assets/543c68e8-5b7e-4543-bf83-f46a808c5e71" />

## Prerequisites

- Node.js 20.19 or later on the 20 line, or 22.12 or later (the minimum of `camusdb` 0.9)
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
7. **Branch** — `CREATE DATABASE what_if_inventory BRANCH FROM camusbooking`, switch with `X-Camus-Database`. A database name holds only letters, digits, and `_`.
8. **Time machine** — `SELECT … AS OF SYSTEM TIME '-30s'`, then recover a dropped `flights` table with `RELINK`. Run the drop on the root database: a table that a branch got from its parent does not show in the branch's `SHOW ORPHAN TABLES`.

## Learn CamusDB from this code

Each section names a CamusDB idea, shows the short form, and points to the file that uses it.

### 1. One client for each database — [`src/lib/camus/client.ts`](src/lib/camus/client.ts)

```ts
const client = new CamusClient({
  endpoint: 'http://localhost:5095',
  database: 'camusbooking',
  timeoutSeconds: 30,
  int64: 'number',
  defaultTransactionOptions: { isolationLevel: CamusIsolationLevel.Serializable },
});
```

- A `CamusClient` is bound to one database. `getClient(database)` keeps one client for each database: the root and each branch.
- A client opens no socket of its own. The connections, the endpoint health, and the prepared statements are shared in the process. So a client for a new branch costs almost nothing.
- `int64: 'number'` makes every `INT64` column a `number`. The default (`'auto'`) gives a `bigint` above 2^53. Seat counts never get near that, so one plain type is simpler.
- `defaultTransactionOptions` sets the isolation of every transaction of the client. Without it, the server default applies.
- `getClient()` with no argument uses the database of the current request. [`src/lib/camus/context.ts`](src/lib/camus/context.ts) keeps it in `AsyncLocalStorage`, so the service functions do not pass it around.

### 2. Schema that is safe to run on every start — [`src/lib/camus/schema.ts`](src/lib/camus/schema.ts)

```ts
await client.createDatabase('camusbooking', { ifNotExists: true });
await client.executeDdl('CREATE TABLE IF NOT EXISTS flights (id OID PRIMARY KEY NOT NULL, ...)');
await client.executeDdl('CREATE UNIQUE INDEX IF NOT EXISTS flights_flight_number_idx ON flights (flight_number)');
```

DDL runs outside transactions. `IF NOT EXISTS` makes each statement a no-op when the object is there. The app does not need to catch "already exists" errors.

### 3. Parameters and types — [`src/lib/services/booking.ts`](src/lib/services/booking.ts)

```ts
await client.queryOne<FlightRow>('SELECT ... FROM flights WHERE id = @id', { id: camus.id(flightId) });
```

- Bind every value as a `@name` parameter. Never join values into the SQL text.
- The driver infers the column type from the JavaScript value. Use a `camus.*` helper when the inference is not the column's type:
  - `camus.id(hex)` for an `OID` column. A plain string binds as `STRING`, and the server refuses it for an `OID` (`CADB0401`).
  - `camus.float64(642)` for a `FLOAT64` column. A whole number binds as `INT64`.
- A `Date` binds as `DATETIME`, and a `DATETIME` column reads back as a `Date`.

### 4. Typed rows — [`src/lib/camus/map.ts`](src/lib/camus/map.ts)

```ts
const { rows } = await client.query<FlightRow>(`${flightSelect} ORDER BY departs_at`);
const flight = await client.queryOne<FlightRow>(`${flightSelect} WHERE id = @id`, { id }); // FlightRow | undefined
const count = await client.scalar<number>('SELECT COUNT(*) FROM bookings');            // number | undefined
```

The type argument is documentation and editor support. The driver does not check it against the schema. So each `*Row` interface stays next to its `SELECT` list, and a `map*` function turns the snake_case row into the camelCase API model.

### 5. Writes — [`src/lib/services/booking.ts`](src/lib/services/booking.ts), [`src/lib/outbox/outbox.ts`](src/lib/outbox/outbox.ts)

```ts
await client.insert('bookings', { id: camus.id(bookingId), seats: 2, created_at: new Date() /* ... */ });
await client.execute('UPDATE flights SET seats_available = seats_available - @seats WHERE id = @id', { seats, id });
```

`insert` writes one row from a column-to-value map, with no SQL text. `execute` returns `{ affectedRows }`.

Static SQL text is also faster: after a statement runs two times, the driver prepares it and sends only a handle. `updatePayment` in [`src/lib/services/payments.ts`](src/lib/services/payments.ts) uses `COALESCE(@field, field)` so that its text stays the same for every call.

### 6. Transactions — `createBooking` in [`src/lib/services/booking.ts`](src/lib/services/booking.ts)

```ts
const booking = await client.transaction(async (txn) => {
  const flight = await client.queryOne<FlightRow>(sql, params, { transaction: txn });
  await client.execute(update, params, { transaction: txn });
  return result;
});
wakeRelay(); // side effects go after the commit
```

- `client.transaction` begins a transaction and runs the function. It commits when the function returns, and rolls back when it throws.
- A statement joins the transaction with `{ transaction: txn }`. Without that option, it runs in its own short transaction.
- The client sets serializable isolation (section 1). Two bookings that race for the last seat conflict (`CADB0502`). `client.transaction` then runs the whole function again on a new transaction, up to 5 times. The new attempt reads the new seat count.
- **So the function can run more than one time.** It must only read and write the database. An HTTP call or an email goes after the transaction, or through the outbox (next section).
- When the work does not fit in one function, use `await using txn = await client.beginTransaction()` and `await txn.commit()`. `await using` rolls back a transaction that the block leaves without a commit.

### 7. Side effects through an outbox — [`src/lib/outbox/`](src/lib/outbox)

The booking transaction cannot call the payment gateway, because a retry would charge the card again. So it inserts an `outbox` row in the same transaction. The relay sends the row after the commit and records the result in a second transaction. See [Payments and the outbox](#payments-and-the-outbox).

### 8. Errors — [`src/lib/errors.ts`](src/lib/errors.ts)

```ts
if (CamusError.is(error) && error.code === 'CADB0300') { /* duplicate key */ }
if (isRetryable(error)) { /* a lost conflict */ }
```

Every database failure is a `CamusError` with a `CADBxxxx` code. Switch on `code`. The message is human text and can change. `CamusErrorCode` names only the codes that the driver itself uses, so the app names `CADB0300` (duplicate key) itself.

The idempotency key uses this: two requests with one key both find no booking, and the unique index refuses the second insert with `CADB0300`. The second request then reads and returns the first booking.

### 9. Branches, time travel, and dropped tables — [`src/lib/camus/admin.ts`](src/lib/camus/admin.ts)

```ts
await client.createBranchDatabase('what_if_inventory', 'camusbooking', { ifNotExists: true });
await client.showBranches('camusbooking');
await client.queryOne(`SELECT ... FROM flights AS OF SYSTEM TIME ${sqlLiteral('-30s', 'as of')} WHERE id = @id`, { id });
await client.executeDdl(`CREATE TABLE ${delimitIdentifier(name, 'table')} RELINK TO ${sqlLiteral(orphanId, 'orphan id')}`);
```

DDL and `AS OF SYSTEM TIME` take no parameters. When a name or a literal comes from the user, `delimitIdentifier` and `sqlLiteral` quote it, and they refuse input that could end the quote.

## Payments and the outbox

A booking does not call the payment gateway itself. It writes the payment request to the `outbox` table in the same transaction as the seat hold, so the request exists if and only if the hold committed. A relay then delivers it.

```
POST /api/bookings ──txn──▶ bookings (pending_payment) + payments (pending) + outbox (payment.requested)
relay ──▶ POST /api/gateway/v1/payment_intents   Idempotency-Key: <outbox id>
gateway ──▶ POST /api/webhooks/payments           Gateway-Signature: t=…,v1=<HMAC-SHA256>
webhook ──txn──▶ booking confirmed | payment_failed (seats released) + processed_webhooks
```

- **Relay** — runs in the Next.js server process, started from `src/instrumentation-node.ts`. It claims due messages with a 5 s lease, so a relay that dies loses its claim and another pass takes the message again. A failed call retries with exponential backoff; after 5 attempts, or on a request the gateway rejects, the message becomes `dead` and the booking's hold is released. It also drains every branch of the database.
- **Idempotency** — the outbox id is the gateway idempotency key, so a message sent twice (after a relay crash) creates one payment intent. The webhook handler stores each event id in `processed_webhooks` in the same transaction as its change, so a duplicate delivery changes nothing.
- **Fake gateway** — Stripe-shaped `payment_intents` and `refunds` endpoints under `/api/gateway/v1`, with Stripe test payment methods: `pm_card_visa` succeeds, `pm_card_chargeDeclined` and `pm_card_chargeDeclinedInsufficientFunds` fail. It keeps its state in memory, so a restart clears it. Webhooks that do not get a 2xx answer are sent again with backoff.
- **Refunds** — cancelling a paid booking writes a `refund.requested` message in the cancel transaction. A payment that succeeds after its hold ended (for example, after the relay gave up on a call the gateway did process) is refunded the same way. A booking whose payment is still in progress cannot be cancelled (409).

The **Payments and outbox** panel in the lab shows the outbox, the gateway's intents, and its webhook deliveries, with switches to pause or crash the relay and to break the gateway.

## Layout

```
src/
  app/                Next.js App Router pages and route handlers
  components/         Header, lab payments panel
  instrumentation.ts  Next.js startup hook; loads the Node.js part only in the Node.js runtime
  instrumentation-node.ts  Bootstraps CamusDB and starts the outbox relay
  lib/camus/          Client per database, request context, schema, row types, seed, admin, demos
  lib/outbox/         Outbox writes and the relay
  lib/payments/       Fake gateway, its HTTP client, webhook signatures
  lib/services/       Booking and payment transactions, booking events
  lib/http.ts         withCamus: the wrapper of every route handler
  test/helpers.ts     Shared helpers for the integration tests
```

The UI talks to `/api/*`. A route handler calls `withCamus`, which runs the bootstrap, binds the request's database, and turns an error into a JSON problem response. Every mutating booking goes through `client.transaction()`.

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

Integration tests skip if CamusDB is not reachable. They run against their own `camusbooking_test` database (override with `CAMUS_TEST_DATABASE`), so they do not use the demo's seats. They cover the booking flow, the idempotency key, the last-seat race, each failure injection point, and the payment flows. The payment tests drive the relay with a stub gateway.

```bash
npm test
```
