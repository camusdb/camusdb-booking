const DATABASE_KEY = 'camus-database';

export function getDatabase(): string {
  if (typeof window === 'undefined') return 'camusbooking';
  return localStorage.getItem(DATABASE_KEY) || 'camusbooking';
}

export function setDatabase(database: string): void {
  localStorage.setItem(DATABASE_KEY, database);
  window.dispatchEvent(new Event('camus-database'));
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');
  const database = getDatabase();
  if (database) headers.set('X-Camus-Database', database);

  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || body.title || response.statusText);
  }
  return body as T;
}
