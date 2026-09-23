export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { register: bootstrapCamus } = await import('./lib/camus/bootstrap');
  await bootstrapCamus();

  // The outbox relay runs in the server process for the life of the process. It tolerates a CamusDB
  // node that is not up yet: a failed pass is recorded and the next poll tries again.
  const { startRelay } = await import('./lib/outbox/relay');
  startRelay();
}
