import { NextResponse } from 'next/server';
import { authorize, GatewayError } from '@/lib/payments/gateway';

/** Runs one gateway API call and answers in the gateway's own error format. */
export async function gatewayCall(request: Request, work: (body: unknown, idempotencyKey: string | null) => unknown) {
  try {
    authorize(request.headers.get('authorization'));
    const body = await request.json().catch(() => {
      throw new GatewayError(400, 'parameter_invalid', 'The request body is not valid JSON.');
    });
    return NextResponse.json(work(body, request.headers.get('idempotency-key')));
  } catch (error) {
    const gatewayError =
      error instanceof GatewayError ? error : new GatewayError(500, 'api_error', error instanceof Error ? error.message : 'Unexpected error');
    return NextResponse.json(gatewayError.toJSON(), { status: gatewayError.status });
  }
}
