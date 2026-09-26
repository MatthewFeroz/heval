import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.HEVAL_TEST_PORT ?? 4174)

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  webServer: {
    command: `bun run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: { VITE_WORKOS_CLIENT_ID: '', VITE_CONVEX_URL: '' },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
