import { createPaymentIntent, type CreateIntentParams } from '@/lib/payments/gateway';
import { gatewayCall } from '@/lib/payments/gateway-http';

export const runtime = 'nodejs';

export function POST(request: Request) {
  return gatewayCall(request, (body, idempotencyKey) => createPaymentIntent(body as CreateIntentParams, idempotencyKey));
}
