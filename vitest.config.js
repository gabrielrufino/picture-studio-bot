import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          include: ['src/repositories/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          globalSetup: ['./src/test/mongodb.global-setup.ts'],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          exclude: ['src/repositories/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        },
      },
    ],
    coverage: {
      exclude: ['src/test/**'],
    },
  },
})
