import { withCamus } from '@/lib/http';
import { deleteFlightRow, dropFlightsTable } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json()) as { mode?: 'row' | 'table'; flightId?: string };
  return withCamus(request, async () => {
    if (body.mode === 'table') {
      await dropFlightsTable();
      return { dropped: 'flights' };
    }
    if (!body.flightId) throw new Error('flightId is required for a row delete.');
    await deleteFlightRow(body.flightId);
    return { deleted: body.flightId };
  });
}
