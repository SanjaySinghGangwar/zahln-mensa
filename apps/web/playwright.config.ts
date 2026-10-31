import { defineConfig, devices } from '@playwright/test';

// Runs against the live test API. Set E2E_BASE_URL to test the deployed dashboard,
// otherwise a local dev server is started.
const remote = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 1,
  use: { baseURL: remote ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: remote ? undefined : { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
