import { NextResponse } from 'next/server';
import { bootstrap } from '@/lib/camus/bootstrap';
import { runWithStore } from '@/lib/camus/context';
import { toErrorPayload } from '@/lib/errors';
import type { GatewayEvent } from '@/lib/payments/gateway';
import { SIGNATURE_HEADER, verifySignature } from '@/lib/payments/signature';
import { handleGatewayEvent } from '@/lib/services/payments';

export const runtime = 'nodejs';

const handled = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed']);

export async function POST(request: Request) {
  // The signature covers the exact bytes, so read the raw text before any parse.
  const body = await request.text();
  if (!verifySignature(body, request.headers.get(SIGNATURE_HEADER))) {
    return NextResponse.json({ title: 'Unauthorized', detail: 'Invalid webhook signature.', status: 400 }, { status: 400 });
  }

  const event = JSON.parse(body) as GatewayEvent;
  if (!handled.has(event.type)) return NextResponse.json({ received: true, ignored: event.type });

  try {
    await bootstrap();
    // The relay put the booking's database in the intent metadata, so a branch gets its own events.
    const database = event.data.object.metadata.database || undefined;
    const result = await runWithStore({ database }, () => handleGatewayEvent(event));
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    // A non-2xx answer makes the gateway deliver the event again later.
    const payload = toErrorPayload(error);
    return NextResponse.json(payload, { status: payload.status >= 500 ? payload.status : 500 });
  }
}
