import { withCamus } from '@/lib/http';
import { createBooking, listBookings } from '@/lib/services/booking';
import type { CreateBookingRequest } from '@/lib/types';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const flightId = new URL(request.url).searchParams.get('flightId') ?? undefined;
  return withCamus(request, () => listBookings(flightId));
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBookingRequest;
  return withCamus(request, () => createBooking(body), 201);
}
