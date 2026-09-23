import { HttpError } from '@/lib/errors';
import { withCamus } from '@/lib/http';
import { listOutbox } from '@/lib/outbox/outbox';
import { armCrashAfterPublish, drainOnce, relayState, setRelayPaused } from '@/lib/outbox/relay';
import type { OutboxOverview } from '@/lib/types';

export const runtime = 'nodejs';

export function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 15);
  return withCamus(request, async (): Promise<OutboxOverview> => ({ relay: relayState(), messages: await listOutbox(limit) }));
}

export async function POST(request: Request) {
  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  return withCamus(request, async () => {
    switch (action) {
      case 'pause':
        return setRelayPaused(true);
      case 'resume':
        return setRelayPaused(false);
      case 'drain':
        await drainOnce();
        return relayState();
      case 'crashAfterPublish':
        return armCrashAfterPublish();
      default:
        throw new HttpError(400, 'action must be pause, resume, drain, or crashAfterPublish.');
    }
  });
}
