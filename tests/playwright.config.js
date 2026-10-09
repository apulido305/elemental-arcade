import { defineConfig } from '@playwright/test';

// Every test builds its own backend + http server on a random port (see helpers/fixtures.js), so tests
// are independent and can run in parallel. Chromium only; per-device viewport is chosen in arena.device().
export default defineConfig({
  testDir: './specs',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results',
  use: { browserName: 'chromium', headless: true, trace: 'off' }
});
