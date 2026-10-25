import { CamusError } from 'camusdb';
import { expect, it } from 'vitest';
import { DUPLICATE_KEY, HttpError, isUniqueViolation, toErrorPayload } from '@/lib/errors';

it('reads a duplicate key from the error code, not from the message', () => {
  expect(isUniqueViolation(new CamusError(DUPLICATE_KEY, 'Duplicate entry for key bookings.~pk'))).toBe(true);
  expect(isUniqueViolation(new CamusError('CADB0400', 'something unique happened'))).toBe(false);
  expect(isUniqueViolation(new Error('duplicate'))).toBe(false);
});

it('answers 409 for a lost conflict and a duplicate key, and 500 for another database error', () => {
  expect(toErrorPayload(new CamusError('CADB0502', 'locked by another transaction'))).toMatchObject({ status: 409, code: 'CADB0502' });
  expect(toErrorPayload(new CamusError(DUPLICATE_KEY, 'Duplicate entry'))).toMatchObject({ status: 409 });
  expect(toErrorPayload(new CamusError('CADB0404', 'Unknown column'))).toMatchObject({ status: 500, code: 'CADB0404' });
});

it('keeps the status of an HttpError', () => {
  expect(toErrorPayload(new HttpError(422, 'reused key'))).toEqual({ title: 'HttpError', detail: 'reused key', status: 422 });
});
