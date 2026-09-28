import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // The native addon must stay outside the bundle and be loaded from disk.
      // `original-fs` is an Electron built-in — the fs without the asar patch,
      // which the portable sweep needs (HTOO-494) — and Rollup cannot resolve
      // it, so it is external too.
      rollupOptions: { external: ['da-pcap', 'original-fs'] }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // './' is required for file:// in production; '/' is required for HMR in dev
    base: command === 'build' ? './' : '/',
    publicDir: resolve('resources'),
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      hmr: true
    },
    build: {
      outDir: 'out/renderer'
    }
  }
}))
