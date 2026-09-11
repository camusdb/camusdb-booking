import { camus, delimitIdentifier, sqlLiteral } from 'camusdb';
import { camusEndpoint, getClient, rootDatabase } from './client';
import { flightSelect, mapFlight, type EventRow, type FlightRow } from './map';
import type { BookingEvent, BranchInfo, CamusHealth, ExplainResult, Flight, OrphanInfo } from '../types';
import { mapEvent } from './map';

export async function ping(): Promise<CamusHealth> {
  const client = getClient();
  const ok = await client.ping();
  return { ok, endpoint: camusEndpoint(), database: client.database };
}

export async function listBranches(): Promise<BranchInfo[]> {
  const rows = await getClient().showBranches(rootDatabase());
  return rows.map((row) => ({
    name: row.database ?? '',
    parent: row.parent ?? null,
    depth: row.depth,
    forkTimestamp: row.forkTimestamp ?? null,
  }));
}

export async function createBranch(name: string, sourceDatabase?: string): Promise<void> {
  await getClient().createBranchDatabase(name, sourceDatabase || rootDatabase(), { ifNotExists: true });
}

export async function dropBranch(name: string): Promise<void> {
  await getClient().dropDatabase(name);
}

export async function listOrphans(): Promise<OrphanInfo[]> {
  const { rows } = await getClient().query<Record<string, string>>('SHOW ORPHAN TABLES');
  return rows.map((row) => ({
    id: row.id ?? row.Id,
    formerName: row.former_name ?? row.formerName,
    droppedAt: row.dropped_at ?? row.droppedAt,
    expiresAt: row.expires_at ?? row.expiresAt,
    kind: row.kind ?? 'dropped',
  }));
}

export async function recoverTable(newTableName: string, orphanId: string): Promise<void> {
  await getClient().executeDdl(
    `CREATE TABLE ${delimitIdentifier(newTableName, 'table')} RELINK TO ${sqlLiteral(orphanId, 'orphan id')}`,
  );
}

export async function dropFlightsTable(): Promise<void> {
  await getClient().executeDdl('DROP TABLE flights');
}

export async function timeTravelFlight(id: string, asOf: string): Promise<Flight | undefined> {
  if (!/^[-+]?\d+[smhd]$/.test(asOf) && !/^\d{4}-\d{2}-\d{2}/.test(asOf)) {
    throw new Error('asOf must look like -30s or an ISO timestamp.');
  }

  const row = await getClient().queryOne<FlightRow>(
    `${flightSelect} AS OF SYSTEM TIME ${sqlLiteral(asOf, 'as of')} WHERE id = @id`,
    { id: camus.id(id) },
  );
  return row ? mapFlight(row) : undefined;
}

export async function deleteFlightRow(id: string): Promise<void> {
  await getClient().execute('DELETE FROM flights WHERE id = @id', { id: camus.id(id) });
}

export async function explain(sql: string): Promise<ExplainResult> {
  const statement = sql.trim().toUpperCase().startsWith('EXPLAIN') ? sql : `EXPLAIN ${sql}`;
  const result = await getClient().query<Record<string, unknown>>(statement);
  const plan = result.rows
    .map((row) => result.columns.map((column) => String(row[column.name] ?? 'NULL')).join(' | '))
    .join('\n');
  return { sql: statement, plan };
}

export async function recentEvents(limit = 10): Promise<BookingEvent[]> {
  const take = Math.min(Math.max(limit, 1), 50);
  const { rows } = await getClient().query<EventRow>(
    `SELECT id, booking_id, flight_id, event_type, seats, created_at
     FROM booking_events
     ORDER BY created_at DESC
     LIMIT ${take}`,
  );
  return rows.map(mapEvent);
}
