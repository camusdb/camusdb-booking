import { initializeSchema } from './schema';
import { seedIfNeeded } from './seed';

let bootstrapped: Promise<void> | undefined;

/**
 * Creates the database, the schema, and the demo data, one time for each process. Every route handler
 * awaits it, so the first request after the CamusDB node comes up does the work. A failed attempt is
 * forgotten, and the next call tries again.
 */
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
