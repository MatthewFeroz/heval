import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['server/hosted-exports/**/*.test.ts'], environment: 'node' } })
