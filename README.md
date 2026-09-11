# CamusBooking

A Next.js flight-booking demo on **CamusDB** and the [`camusdb`](https://www.npmjs.com/package/camusdb) TypeScript connector. It holds fake airline inventory in serializable transactions, with idempotent PNRs, last-seat races, copy-on-write branches, time-travel reads, and recoverable drops.

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

1. **Book a seat** — decrement `seats_available`, insert a booking and a `reserved` event in one transaction.
2. **Retry safety** — reuse an idempotency key (or click **Retry 3×**). One PNR.
3. **Last-seat race** — in the lab, run 50 concurrent bookings against CM055 (2 seats). Expect 2 successes.
4. **Failure injection** — abort after the seat hold or before commit; inventory and events roll back.
5. **Branch** — `CREATE DATABASE what-if-inventory BRANCH FROM camusbooking`, switch with `X-Camus-Database`.
6. **Time machine** — `SELECT … AS OF SYSTEM TIME '-30s'`, then recover a dropped `flights` table with `RELINK`.

## Layout

```
src/
  app/            Next.js App Router pages and route handlers
  components/     Header
  lib/camus/      CamusClient factory, schema, seed, admin, demos
  lib/services/   Booking transactions
```

The UI talks to `/api/*`. Every mutating booking goes through `CamusClient.beginTransaction()` and `withRetry` from the connector.

## Configuration

`.env.local`:

```
CAMUS_ENDPOINT=http://localhost:5095
CAMUS_DATABASE=camusbooking
CAMUS_TIMEOUT=30
```

Send `X-Camus-Database` (or switch in the lab) to pin a request to a branch.

## Tests

Integration tests skip if CamusDB is not reachable.

```bash
npm test
```
