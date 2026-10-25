/** Next.js calls this one time when the server process starts. */
export async function register(): Promise<void> {
  // The camusdb driver needs Node.js APIs, so it does not run in the edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { bootstrap } = await import('./lib/camus/bootstrap');
  // The app still starts when CamusDB is down. The route handlers report the error and call
  // bootstrap again until the node answers.
  await bootstrap().catch(() => undefined);

  // The outbox relay runs in the server process for the life of the process. It tolerates a CamusDB
  // node that is not up yet: a failed pass is recorded and the next poll tries again.
  const { startRelay } = await import('./lib/outbox/relay');
  startRelay();
}
