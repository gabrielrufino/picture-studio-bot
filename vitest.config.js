import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    globalSetup: ['./src/test/mongodb.global-setup.ts'],
    coverage: {
      exclude: ['src/test/**'],
    },
  },
})
