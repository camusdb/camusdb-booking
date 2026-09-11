import { withCamus } from '@/lib/http';
import { dropBranch } from '@/lib/camus/admin';

export const runtime = 'nodejs';

export async function DELETE(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  return withCamus(request, () => dropBranch(decodeURIComponent(name)));
}
