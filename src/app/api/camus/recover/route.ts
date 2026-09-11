import { withCamus } from '@/lib/http';
import { recoverTable } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json()) as { newTableName: string; orphanId: string };
  return withCamus(request, () => recoverTable(body.newTableName, body.orphanId));
}
