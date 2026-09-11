import { AsyncLocalStorage } from 'node:async_hooks';
import type { FailurePoint } from '../types';
import { HttpError } from '../errors';

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

export function currentDatabase(): string {
  return getStore().database || process.env.CAMUS_DATABASE || 'camusbooking';
}

export function maybeFail(point: FailurePoint): void {
  if (getStore().failure === point) {
    throw new HttpError(400, `Injected failure at ${point}.`);
  }
}
