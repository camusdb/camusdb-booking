import { withCamus } from '@/lib/http';
import { getSeedSummary } from '@/lib/camus/seed';
import { ping } from '@/lib/camus/admin';
import { currentDatabase } from '@/lib/camus/context';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return withCamus(request, async () => {
    const [summary, health] = await Promise.all([getSeedSummary(), ping()]);
    return { ...summary, health, database: currentDatabase() };
  });
}
