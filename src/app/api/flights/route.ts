import { withCamus } from '@/lib/http';
import { listFlights } from '@/lib/services/booking';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return withCamus(request, () => listFlights());
}
