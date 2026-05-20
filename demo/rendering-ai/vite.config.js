import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: './',
  publicDir: './public',
  resolve: {
    alias: {
      '../../src/': resolve(__dirname, '../../../src/') + '/',
    },
  },
  optimizeDeps: {
    include: ['effect'],
  },
  build: {
    outDir: './dist',
    rollupOptions: {
      input: './index.html'
    }
  }
})
