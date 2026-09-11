import { withCamus } from '@/lib/http';
import { timeTravelFlight } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const asOf = new URL(request.url).searchParams.get('asOf') ?? '-30s';
  return withCamus(request, () => timeTravelFlight(id, asOf));
}
