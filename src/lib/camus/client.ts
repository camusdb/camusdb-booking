import { CamusClient } from 'camusdb';
import { currentDatabase } from './context';

export function rootDatabase(): string {
  return process.env.CAMUS_DATABASE || 'camusbooking';
}

export function camusEndpoint(): string {
  return process.env.CAMUS_ENDPOINT || 'http://localhost:5095';
}

export function getClient(database = currentDatabase()): CamusClient {
  const timeout = Number(process.env.CAMUS_TIMEOUT || 30);
  return new CamusClient({
    endpoint: camusEndpoint(),
    database,
    timeoutSeconds: Number.isFinite(timeout) ? timeout : 30,
  });
}

export function resolveRequestDatabase(request: Request): string | undefined {
  const header = request.headers.get('x-camus-database')?.trim();
  if (header) return header;

  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)camus-database=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
