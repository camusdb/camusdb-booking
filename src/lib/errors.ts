import { CamusError, isRetryable } from 'camusdb';

/** An error that the API sends to the browser with a chosen HTTP status. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * The server code for a write that breaks a unique index or a primary key. `CamusErrorCode` names
 * only the codes that the driver itself reacts to, so the app names this one.
 */
export const DUPLICATE_KEY = 'CADB0300';

/** Switch on `error.code`. The message is human text and can change between server versions. */
export function isUniqueViolation(error: unknown): boolean {
  return CamusError.is(error) && error.code === DUPLICATE_KEY;
}

export interface ErrorPayload {
  title: string;
  detail: string;
  status: number;
  /** The CamusDB `CADBxxxx` code, when the error came from the database. */
  code?: string;
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof HttpError) {
    return { title: error.name, detail: error.message, status: error.status };
  }

  if (CamusError.is(error)) {
    // A retryable error is a lost conflict that `client.transaction` retried until it gave up.
    const conflict = isRetryable(error) || isUniqueViolation(error);
    return { title: 'CamusError', detail: error.message, status: conflict ? 409 : 500, code: error.code };
  }

  if (error instanceof Error) {
    return { title: error.name, detail: error.message, status: 400 };
  }

  return { title: 'Error', detail: 'Unexpected error', status: 500 };
}
