/** Next.js calls this one time when the server process starts. */
export async function register(): Promise<void> {
  // In development, Next.js compiles this file for the edge runtime too, where the camusdb driver
  // cannot run because it needs Node.js APIs such as `node:crypto`. Next.js replaces NEXT_RUNTIME with
  // a constant, so in the edge build this branch is dead and webpack does not follow its import. Keep
  // the import inside the `if`: an early `return` does not stop webpack from bundling it.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { start } = await import('./instrumentation-node');
    await start();
  }
}
