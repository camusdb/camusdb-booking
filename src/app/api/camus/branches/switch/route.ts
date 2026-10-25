import { NextResponse } from 'next/server';
import { currentDatabase, rootDatabase } from '@/lib/camus/client';
import { withCamus } from '@/lib/http';

export const runtime = 'nodejs';

export function GET(request: Request) {
  return withCamus(request, async () => ({ database: currentDatabase() }));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { database?: string };
  const database = body.database?.trim() || '';
  const response = NextResponse.json({ database: database || rootDatabase() });
  if (database) {
    response.cookies.set('camus-database', database, { path: '/' });
  } else {
    response.cookies.delete('camus-database');
  }
  return response;
}
