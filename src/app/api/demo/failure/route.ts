import { withCamus } from '@/lib/http';
import { injectFailure } from '@/lib/camus/demo';
import type { CreateBookingRequest, FailurePoint } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBookingRequest & { failurePoint: FailurePoint };
  return withCamus(request, () => injectFailure(body, body.failurePoint));
}
