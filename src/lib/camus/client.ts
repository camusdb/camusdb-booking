import { CamusClient, CamusIsolationLevel } from 'camusdb';
import { requestDatabase } from './context';

export function rootDatabase(): string {
  return process.env.CAMUS_DATABASE || 'camusbooking';
}

export function camusEndpoint(): string {
  return process.env.CAMUS_ENDPOINT || 'http://localhost:5095';
}

function timeoutSeconds(): number {
  const timeout = Number(process.env.CAMUS_TIMEOUT || 30);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 30;
}

/** The database of the current request: the branch it pinned, or the root database. */
export function currentDatabase(): string {
  return requestDatabase() ?? rootDatabase();
}

const clients = new Map<string, CamusClient>();

/**
 * Returns the client for one database. A `CamusClient` is bound to one database, so the app keeps
 * one client for each database (the root and each branch) that it talks to.
 *
 * A client opens no socket of its own. The connections, the endpoint health, and the prepared
 * statements are shared by every client in the process, so a client for a new branch starts warm.
 */
export function getClient(database = currentDatabase()): CamusClient {
  let client = clients.get(database);
  if (!client) {
    client = new CamusClient({
      endpoint: camusEndpoint(),
      database,
      timeoutSeconds: timeoutSeconds(),
      // An INT64 column reads as a `number` or, above 2^53, as a `bigint`. Seat counts and attempt
      // counters never get near 2^53, so 'number' gives the row types one plain type.
      int64: 'number',
      // The booking code reads a seat count and then writes it. Serializable isolation makes that
      // safe: two transactions that race for the last seat conflict, and one of them runs again.
      defaultTransactionOptions: { isolationLevel: CamusIsolationLevel.Serializable },
    });
    clients.set(database, client);
  }
  return client;
}
