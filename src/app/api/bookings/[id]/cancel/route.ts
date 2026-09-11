import { withCamus } from '@/lib/http';
import { cancelBooking } from '@/lib/services/booking';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withCamus(request, () => cancelBooking(id));
}
