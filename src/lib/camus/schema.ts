import { getClient, rootDatabase } from './client';

/**
 * The schema, as DDL that is safe to run on every start. `IF NOT EXISTS` makes each statement a
 * no-op when its table or index is already there.
 *
 * - `OID` is a 12-byte ObjectId. Bind it with `camus.id(...)`: a plain string binds as `STRING`, and
 *   the server refuses a `STRING` for an `OID` column.
 * - `INT64` reads as a `number`, because the client sets `int64: 'number'`.
 * - `DATETIME` reads as a JavaScript `Date`, in UTC.
 */
const ddl = [
  `
  CREATE TABLE IF NOT EXISTS passengers (
    id OID PRIMARY KEY NOT NULL,
    name STRING NOT NULL,
    email STRING NOT NULL
  )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS passengers_email_idx ON passengers (email)',
  `
  CREATE TABLE IF NOT EXISTS flights (
    id OID PRIMARY KEY NOT NULL,
    flight_number STRING NOT NULL,
    airline STRING NOT NULL,
    origin STRING NOT NULL,
    destination STRING NOT NULL,
    departs_at DATETIME NOT NULL,
    arrives_at DATETIME NOT NULL,
    cabin STRING NOT NULL,
    fare FLOAT64 NOT NULL,
    seats_total INT64 NOT NULL,
    seats_available INT64 NOT NULL,
    status STRING NOT NULL,
    created_at DATETIME NOT NULL
  )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS flights_flight_number_idx ON flights (flight_number)',
  'CREATE INDEX IF NOT EXISTS flights_departs_at_idx ON flights (departs_at)',
  `
  CREATE TABLE IF NOT EXISTS bookings (
    id OID PRIMARY KEY NOT NULL,
    passenger_id OID NOT NULL,
    flight_id OID NOT NULL,
    seats INT64 NOT NULL,
    total FLOAT64 NOT NULL,
    status STRING NOT NULL,
    pnr STRING NOT NULL,
    idempotency_key STRING NOT NULL,
    created_at DATETIME NOT NULL
  )
  `,
  // The unique index is what makes the idempotency key safe under concurrency: two requests with one
  // key cannot both insert a booking.
  'CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key_idx ON bookings (idempotency_key)',
  'CREATE UNIQUE INDEX IF NOT EXISTS bookings_pnr_idx ON bookings (pnr)',
  'CREATE INDEX IF NOT EXISTS bookings_flight_id_idx ON bookings (flight_id)',
  `
  CREATE TABLE IF NOT EXISTS booking_events (
    id OID PRIMARY KEY NOT NULL,
    booking_id OID,
    flight_id OID NOT NULL,
    event_type STRING NOT NULL,
    seats INT64 NOT NULL,
    created_at DATETIME NOT NULL
  )
  `,
  'CREATE INDEX IF NOT EXISTS booking_events_flight_id_idx ON booking_events (flight_id)',
  'CREATE INDEX IF NOT EXISTS booking_events_created_at_idx ON booking_events (created_at)',
  `
  CREATE TABLE IF NOT EXISTS payments (
    id OID PRIMARY KEY NOT NULL,
    booking_id OID NOT NULL,
    intent_id STRING NOT NULL,
    amount FLOAT64 NOT NULL,
    payment_method STRING NOT NULL,
    status STRING NOT NULL,
    failure_reason STRING NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
  )
  `,
  'CREATE UNIQUE INDEX IF NOT EXISTS payments_booking_id_idx ON payments (booking_id)',
  `
  CREATE TABLE IF NOT EXISTS outbox (
    id OID PRIMARY KEY NOT NULL,
    aggregate_id OID NOT NULL,
    topic STRING NOT NULL,
    payload STRING NOT NULL,
    status STRING NOT NULL,
    attempts INT64 NOT NULL,
    next_attempt_at DATETIME NOT NULL,
    last_error STRING NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
  )
  `,
  'CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox (status)',
  'CREATE INDEX IF NOT EXISTS outbox_created_at_idx ON outbox (created_at)',
  `
  CREATE TABLE IF NOT EXISTS processed_webhooks (
    event_id STRING PRIMARY KEY NOT NULL,
    event_type STRING NOT NULL,
    received_at DATETIME NOT NULL
  )
  `,
  `
  CREATE TABLE IF NOT EXISTS app_metadata (
    meta_key STRING PRIMARY KEY NOT NULL,
    value STRING NOT NULL
  )
  `,
];

export async function initializeSchema(): Promise<void> {
  const client = getClient(rootDatabase());
  await client.createDatabase(rootDatabase(), { ifNotExists: true });

  // DDL runs outside any transaction, one statement at a time.
  for (const statement of ddl) {
    await client.executeDdl(statement);
  }
}
