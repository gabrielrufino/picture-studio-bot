import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    projects: [
      {
        name: 'repository',
        resolve: { tsconfigPaths: true },
        test: {
          include: ['src/repositories/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          globalSetup: ['./src/test/mongodb.global-setup.ts'],
        },
      },
      {
        name: 'general',
        resolve: { tsconfigPaths: true },
        test: {
          include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          exclude: ['src/repositories/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        },
      },
      {
        name: 'test-helpers',
        resolve: { tsconfigPaths: true },
        test: {
          include: ['src/test/mongodb.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          globalSetup: ['./src/test/mongodb.global-setup.ts'],
        },
      },
    ],
    coverage: {
      exclude: ['src/test/**'],
    },
  },
})
