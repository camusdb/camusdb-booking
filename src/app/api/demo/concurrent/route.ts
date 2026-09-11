import { withCamus } from '@/lib/http';
import { runConcurrentBookings } from '@/lib/camus/demo';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json()) as {
    flightId: string;
    passengerId: string;
    concurrency?: number;
  };
  return withCamus(request, () =>
    runConcurrentBookings(body.flightId, body.passengerId, body.concurrency ?? 50),
  );
}
