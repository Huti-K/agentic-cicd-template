import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: resolve('e2e/agent'),
  outputDir: resolve('.agent-output/browser-results'),
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  globalTimeout: 180_000,
  reporter: [['list'], ['html', { outputFolder: resolve('.agent-output/browser-report'), open: 'never' }], ['json', { outputFile: resolve('.agent-output/browser-results.json') }]],
  use: { baseURL: 'http://127.0.0.1:4174', video: 'on', screenshot: 'on', trace: 'on' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'node scripts/serve.mjs', cwd: process.cwd(), env: { SERVE_DIR: 'dist', PORT: '4174' }, url: 'http://127.0.0.1:4174', reuseExistingServer: false },
});
