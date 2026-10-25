import { AsyncLocalStorage } from 'node:async_hooks';
import type { FailurePoint } from '../types';
import { HttpError } from '../errors';

/**
 * Per-request state that the service code reads without a parameter on every function.
 *
 * - `database` is the branch that the request pinned with `X-Camus-Database` or the lab cookie.
 *   `getClient()` reads it, so a service function runs against the right branch with no change.
 * - `failure` is the lab's failure injection point. `maybeFail` throws there.
 */
export interface RequestStore {
  database?: string;
  failure?: FailurePoint;
}

const storage = new AsyncLocalStorage<RequestStore>();

export function runWithStore<T>(store: RequestStore, work: () => Promise<T>): Promise<T> {
  return storage.run(store, work);
}

export function getStore(): RequestStore {
  return storage.getStore() ?? {};
}

/** The database that the current request pinned, or `undefined` for the root database. */
export function requestDatabase(): string | undefined {
  return getStore().database || undefined;
}

/** Throws at `point` when the lab asked for a failure there. The throw rolls back the transaction. */
export function maybeFail(point: FailurePoint): void {
  if (getStore().failure === point) {
    throw new HttpError(400, `Injected failure at ${point}.`);
  }
}
