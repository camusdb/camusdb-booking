import { CamusError } from 'camusdb';
import { getClient, rootDatabase } from './client';

const ddl = [
  `
  CREATE TABLE passengers (
    id OID PRIMARY KEY NOT NULL,
    name STRING NOT NULL,
    email STRING NOT NULL
  )
  `,
  'CREATE UNIQUE INDEX passengers_email_idx ON passengers (email)',
  `
  CREATE TABLE flights (
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
  'CREATE UNIQUE INDEX flights_flight_number_idx ON flights (flight_number)',
  'CREATE INDEX flights_departs_at_idx ON flights (departs_at)',
  `
  CREATE TABLE bookings (
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
  'CREATE UNIQUE INDEX bookings_idempotency_key_idx ON bookings (idempotency_key)',
  'CREATE UNIQUE INDEX bookings_pnr_idx ON bookings (pnr)',
  'CREATE INDEX bookings_flight_id_idx ON bookings (flight_id)',
  `
  CREATE TABLE booking_events (
    id OID PRIMARY KEY NOT NULL,
    booking_id OID,
    flight_id OID NOT NULL,
    event_type STRING NOT NULL,
    seats INT64 NOT NULL,
    created_at DATETIME NOT NULL
  )
  `,
  'CREATE INDEX booking_events_flight_id_idx ON booking_events (flight_id)',
  'CREATE INDEX booking_events_created_at_idx ON booking_events (created_at)',
  `
  CREATE TABLE payments (
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
  'CREATE UNIQUE INDEX payments_booking_id_idx ON payments (booking_id)',
  `
  CREATE TABLE outbox (
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
  'CREATE INDEX outbox_status_idx ON outbox (status)',
  'CREATE INDEX outbox_created_at_idx ON outbox (created_at)',
  `
  CREATE TABLE processed_webhooks (
    event_id STRING PRIMARY KEY NOT NULL,
    event_type STRING NOT NULL,
    received_at DATETIME NOT NULL
  )
  `,
  `
  CREATE TABLE app_metadata (
    meta_key STRING PRIMARY KEY NOT NULL,
    value STRING NOT NULL
  )
  `,
];

function isBenignDdl(error: unknown): boolean {
  if (!CamusError.is(error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('already exists') || message.includes('duplicate');
}

export async function initializeSchema(): Promise<void> {
  const client = getClient(rootDatabase());
  await client.createDatabase(rootDatabase(), { ifNotExists: true });

  for (const statement of ddl) {
    try {
      await client.executeDdl(statement);
    } catch (error) {
      if (!isBenignDdl(error)) throw error;
    }
  }
}
