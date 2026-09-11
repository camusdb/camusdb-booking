import { withCamus } from '@/lib/http';
import { HttpError } from '@/lib/errors';
import { getFlight, listBookings } from '@/lib/services/booking';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withCamus(request, async () => {
    const flight = await getFlight(id);
    if (!flight) throw new HttpError(404, 'Flight not found.');
    const bookings = await listBookings(id);
    return { flight, bookings };
  });
}
