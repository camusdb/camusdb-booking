import { bootstrap } from './lib/camus/bootstrap';
import { startRelay } from './lib/outbox/relay';

/** The Node.js part of `register` in `instrumentation.ts`. */
export async function start(): Promise<void> {
  // The app still starts when CamusDB is down. The route handlers report the error and call
  // bootstrap again until the node answers.
  await bootstrap().catch(() => undefined);

  // The outbox relay runs in the server process for the life of the process. It tolerates a CamusDB
  // node that is not up yet: a failed pass is recorded and the next poll tries again.
  startRelay();
}
