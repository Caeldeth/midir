import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    // Required for @testing-library/react's automatic per-test cleanup, which
    // registers itself on a global afterEach.
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', '**/__tests__/**', 'src/preload/**', '**/*.config.*']
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/main/**/__tests__/**/*.test.ts',
            'src/shared/**/__tests__/**/*.test.ts',
            'src/renderer/src/lib/__tests__/**/*.test.ts',
            'scripts/**/*.test.mjs'
          ]
        }
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: [
            'src/renderer/src/__tests__/**/*.test.{ts,tsx}',
            'src/renderer/src/{components,pages,hooks,store}/**/__tests__/**/*.test.{ts,tsx}'
          ],
          setupFiles: ['./src/renderer/src/__tests__/setup/vitest.setup.ts']
        }
      }
    ]
  }
})
