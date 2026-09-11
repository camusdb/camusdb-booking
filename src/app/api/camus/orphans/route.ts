import { withCamus } from '@/lib/http';
import { listOrphans } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return withCamus(request, () => listOrphans());
}
