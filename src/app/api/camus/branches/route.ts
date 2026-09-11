import { withCamus } from '@/lib/http';
import { createBranch, listBranches } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return withCamus(request, () => listBranches());
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name: string; sourceDatabase?: string };
  return withCamus(request, () => createBranch(body.name, body.sourceDatabase));
}
