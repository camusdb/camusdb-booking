import { NextResponse } from 'next/server';
import { bootstrap } from '@/lib/camus/bootstrap';
import { resolveRequestDatabase } from '@/lib/camus/client';
import { runWithStore } from '@/lib/camus/context';
import { toErrorPayload } from '@/lib/errors';

export async function withCamus<T>(
  request: Request,
  work: () => Promise<T>,
  status = 200,
): Promise<NextResponse> {
  try {
    await bootstrap();
    const body = await runWithStore({ database: resolveRequestDatabase(request) }, work);
    if (body === undefined) return new NextResponse(null, { status: status === 200 ? 204 : status });
    return NextResponse.json(body, { status });
  } catch (error) {
    const payload = toErrorPayload(error);
    return NextResponse.json(payload, { status: payload.status });
  }
}
