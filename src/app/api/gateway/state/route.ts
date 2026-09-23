import { NextResponse } from 'next/server';
import { configure, snapshot, type GatewayConfig } from '@/lib/payments/gateway';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(snapshot());
}

export async function POST(request: Request) {
  const patch = (await request.json().catch(() => ({}))) as Partial<GatewayConfig>;
  configure(patch);
  return NextResponse.json(snapshot());
}
