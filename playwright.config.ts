import { defineConfig } from '@playwright/test';
const port = process.env.E2E_PORT || '4321';
const externalBaseURL = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: externalBaseURL || `http://localhost:${port}`,
    headless: true,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  ...(!externalBaseURL && {
    webServer: {
      command: `npm run dev:astro -- --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        SITE_URL: `http://localhost:${port}`,
        DEMO_CATALOG: 'true',
        APP_ENV: 'test',
        SALES_ENABLED: 'false',
        COD_ENABLED: 'true',
      },
    },
  }),
  reporter: 'list',
});
