import { expect, it } from 'vitest';
import { signPayload, verifySignature } from './signature';

const secret = 'whsec_test';
const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });

it('accepts a payload signed with the same secret', () => {
  expect(verifySignature(body, signPayload(body, secret), secret)).toBe(true);
});

it('refuses a changed body, a wrong secret, and a missing header', () => {
  const header = signPayload(body, secret);
  expect(verifySignature(body.replace('evt_1', 'evt_2'), header, secret)).toBe(false);
  expect(verifySignature(body, header, 'whsec_other')).toBe(false);
  expect(verifySignature(body, null, secret)).toBe(false);
  expect(verifySignature(body, 't=abc,v1=00', secret)).toBe(false);
});

it('refuses a signature older than the tolerance', () => {
  const now = Math.floor(Date.now() / 1000);
  const header = signPayload(body, secret, now - 301);
  expect(verifySignature(body, header, secret, now)).toBe(false);
  expect(verifySignature(body, signPayload(body, secret, now - 299), secret, now)).toBe(true);
});
