import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  timeout: 20_000,
  globalTimeout: 180_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4174', video: 'retain-on-failure', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Desktop covers every scenario; repeat only the core journeys on mobile.
    { name: 'mobile', grep: /@mobile/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs',
    env: { SERVE_DIR: 'dist', PORT: '4174' },
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
