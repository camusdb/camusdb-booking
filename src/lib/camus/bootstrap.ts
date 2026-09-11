import { initializeSchema } from './schema';
import { seedIfNeeded } from './seed';

let bootstrapped: Promise<void> | undefined;

export function bootstrap(): Promise<void> {
  bootstrapped ??= (async () => {
    try {
      await initializeSchema();
      await seedIfNeeded();
    } catch (error) {
      bootstrapped = undefined;
      console.error('Failed to bootstrap CamusDB. Is the server running at CAMUS_ENDPOINT?', error);
      throw error;
    }
  })();

  return bootstrapped;
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  try {
    await bootstrap();
  } catch {
    // The app still starts; API routes surface the error until CamusDB is reachable.
  }
}
