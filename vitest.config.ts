import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // Tests write bookings and flights, so they use their own database instead of the demo one.
    env: { CAMUS_DATABASE: process.env.CAMUS_TEST_DATABASE || 'camusbooking_test' },
    // The payment tests drain the whole outbox of the test database, so files must not run at once.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
