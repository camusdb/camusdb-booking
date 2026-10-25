import { NextResponse } from 'next/server';
import { bootstrap } from '@/lib/camus/bootstrap';
import { runWithStore } from '@/lib/camus/context';
import { toErrorPayload } from '@/lib/errors';

/** The branch that a request pins: the `X-Camus-Database` header first, then the lab's cookie. */
export function resolveRequestDatabase(request: Request): string | undefined {
  const header = request.headers.get('x-camus-database')?.trim();
  if (header) return header;

  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)camus-database=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Runs the work of one route handler. It makes sure that the schema exists, binds the request's
 * database for `getClient()`, and turns a thrown error into a JSON problem response.
 */
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
