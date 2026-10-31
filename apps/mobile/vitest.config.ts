import { defineConfig } from 'vitest/config';

// Logic tests for the phone-only code (PIN, confirmation). Native modules are
// mocked; the payment rules themselves are tested in @zahln/core.
export default defineConfig({
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
});
