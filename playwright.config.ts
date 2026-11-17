import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(macChrome) ? macChrome : undefined) },
  },
  webServer: { command: 'pnpm dev', url: 'http://localhost:1420', reuseExistingServer: true },
});
