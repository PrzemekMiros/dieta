import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4321',
    headless: true,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:astro',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      SITE_URL: 'http://localhost:4321',
      DEMO_CATALOG: 'true',
      APP_ENV: 'test',
      SALES_ENABLED: 'false',
    },
  },
  reporter: 'list',
});
