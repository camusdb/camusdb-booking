import { camus, delimitIdentifier, sqlLiteral } from 'camusdb';
import { HttpError } from '../errors';
import { camusEndpoint, getClient, rootDatabase } from './client';
import { eventSelect, flightSelect, mapEvent, mapFlight, type EventRow, type FlightRow } from './map';
import type { BookingEvent, BranchInfo, CamusHealth, ExplainResult, Flight, OrphanInfo } from '../types';

export async function ping(): Promise<CamusHealth> {
  const client = getClient();
  const ok = await client.ping();
  return { ok, endpoint: camusEndpoint(), database: client.database };
}

// ─── Branches ────────────────────────────────────────────────────────────────
//
// A branch is a copy-on-write database: it starts with every row of its source and costs nothing
// until one of the two changes. `getClient(branch)` talks to it like any other database.

export async function listBranches(): Promise<BranchInfo[]> {
  const rows = await getClient().showBranches(rootDatabase());
  return rows.map((row) => ({
    name: row.database ?? '',
    parent: row.parent ?? null,
    depth: row.depth,
    forkTimestamp: row.forkTimestamp ?? null,
  }));
}

/** The characters that CamusDB accepts in a database name. A hyphen is not one of them. */
const DATABASE_NAME = /^[A-Za-z0-9_]{1,255}$/;

export async function createBranch(name: string, sourceDatabase?: string): Promise<void> {
  if (!DATABASE_NAME.test(name)) {
    throw new HttpError(400, `A branch name can hold only letters, digits, and underscores: ${name}`);
  }
  await getClient().createBranchDatabase(name, sourceDatabase || rootDatabase(), { ifNotExists: true });
}

export async function dropBranch(name: string): Promise<void> {
  await getClient().dropDatabase(name);
}

// ─── Dropped tables ──────────────────────────────────────────────────────────
//
// `DROP TABLE` keeps the data as an "orphan" for a retention period. `CREATE TABLE … RELINK TO`
// gives it a name again.

interface OrphanRow {
  id: string;
  kind: string;
  former_name: string;
  dropped_at: string;
  expires_at: string;
}

export async function listOrphans(): Promise<OrphanInfo[]> {
  const { rows } = await getClient().query<OrphanRow>('SHOW ORPHAN TABLES');
  return rows.map((row) => ({
    id: row.id,
    formerName: row.former_name,
    droppedAt: row.dropped_at,
    expiresAt: row.expires_at,
    kind: row.kind,
  }));
}

export async function recoverTable(newTableName: string, orphanId: string): Promise<void> {
  // DDL takes no parameters, so names and literals from the user go through the driver's quoting
  // helpers. They refuse any input that could end the quote.
  await getClient().executeDdl(
    `CREATE TABLE ${delimitIdentifier(newTableName, 'table')} RELINK TO ${sqlLiteral(orphanId, 'orphan id')}`,
  );
}

export async function dropFlightsTable(): Promise<void> {
  await getClient().executeDdl('DROP TABLE flights');
}

export async function deleteFlightRow(id: string): Promise<void> {
  await getClient().execute('DELETE FROM flights WHERE id = @id', { id: camus.id(id) });
}

// ─── Time travel ─────────────────────────────────────────────────────────────

/** Reads a flight as it was at `asOf`: a relative offset such as `-30s`, or an ISO timestamp. */
export async function timeTravelFlight(id: string, asOf: string): Promise<Flight | undefined> {
  if (!/^[-+]?\d+[smhd]$/.test(asOf) && !/^\d{4}-\d{2}-\d{2}/.test(asOf)) {
    throw new Error('asOf must look like -30s or an ISO timestamp.');
  }

  // `AS OF SYSTEM TIME` takes a literal, not a parameter, so `sqlLiteral` quotes it.
  const row = await getClient().queryOne<FlightRow>(
    `${flightSelect} AS OF SYSTEM TIME ${sqlLiteral(asOf, 'as of')} WHERE id = @id`,
    { id: camus.id(id) },
  );
  return row ? mapFlight(row) : undefined;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export async function explain(sql: string): Promise<ExplainResult> {
  const statement = sql.trim().toUpperCase().startsWith('EXPLAIN') ? sql : `EXPLAIN ${sql}`;
  const result = await getClient().query(statement);
  // `columns` comes with every result, so the plan prints in the server's column order.
  const plan = result.rows
    .map((row) => result.columns.map((column) => String(row[column.name] ?? 'NULL')).join(' | '))
    .join('\n');
  return { sql: statement, plan };
}

export async function recentEvents(limit = 10): Promise<BookingEvent[]> {
  const take = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
  const { rows } = await getClient().query<EventRow>(`${eventSelect} ORDER BY created_at DESC LIMIT @take`, { take });
  return rows.map(mapEvent);
}
