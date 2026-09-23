import { HttpError } from '@/lib/errors';
import { withCamus } from '@/lib/http';
import { getBooking } from '@/lib/services/booking';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withCamus(request, async () => {
    const booking = await getBooking(id);
    if (!booking) throw new HttpError(404, 'Booking not found.');
    return booking;
  });
}
