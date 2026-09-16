import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  webServer: {
    command: 'bun run dev -- --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    env: { VITE_WORKOS_CLIENT_ID: '', VITE_CONVEX_URL: '' },
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
