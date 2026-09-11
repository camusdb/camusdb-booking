import { withCamus } from '@/lib/http';
import { recentEvents } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 10);
  return withCamus(request, () => recentEvents(limit));
}
