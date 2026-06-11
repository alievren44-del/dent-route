import { defineConfig, devices } from '@playwright/test';

/**
 * NAV (dent-route) E2E harness — hermetik. Supabase REST/auth/functions page.route ile mock'lanır.
 * webServer = vite dev (port 5180). Specs: tests/e2e/*.spec.ts · support: tests/e2e/support/*
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
