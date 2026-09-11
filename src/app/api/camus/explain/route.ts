import { withCamus } from '@/lib/http';
import { explain } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const sql = new URL(request.url).searchParams.get('sql') ?? '';
  return withCamus(request, () => explain(sql));
}
