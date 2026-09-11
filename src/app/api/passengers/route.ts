import { withCamus } from '@/lib/http';
import { listPassengers } from '@/lib/services/booking';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return withCamus(request, () => listPassengers());
}
