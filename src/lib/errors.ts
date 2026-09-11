import { CamusError } from 'camusdb';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isUniqueViolation(error: unknown): boolean {
  if (!CamusError.is(error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('unique') || message.includes('duplicate');
}

export function toErrorPayload(error: unknown): { title: string; detail: string; status: number } {
  if (error instanceof HttpError) {
    return { title: error.name, detail: error.message, status: error.status };
  }

  if (error instanceof CamusError) {
    const conflict = error.message.toLowerCase().includes('conflict');
    return {
      title: 'CamusError',
      detail: error.message,
      status: conflict ? 409 : 500,
    };
  }

  if (error instanceof Error) {
    return { title: error.name, detail: error.message, status: 400 };
  }

  return { title: 'Error', detail: 'Unexpected error', status: 500 };
}

export function toIso(value: Date | string | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function asNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}
