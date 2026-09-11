import { withCamus } from '@/lib/http';
import { runIdempotencyDemo } from '@/lib/camus/demo';
import type { CreateBookingRequest } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const url = new URL(request.url);
  const requestCount = Number(url.searchParams.get('requestCount') ?? 3);
  const body = (await request.json()) as CreateBookingRequest;
  return withCamus(request, () => runIdempotencyDemo(body, requestCount));
}
