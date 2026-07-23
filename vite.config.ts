import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        // Main process
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['@napi-rs/canvas', /^@napi-rs\/canvas-/],
            },
          },
        },
      },
      {
        // Preload script
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              input: 'electron/preload.ts',
              external: ['electron'],
              output: {
                format: 'cjs',
                inlineDynamicImports: true,
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules[\\/]react(?:-dom|-router-dom)?[\\/]/.test(id)) return 'react-vendor'
          if (/node_modules[\\/](?:react-markdown|remark-gfm|unified|micromark|mdast|hast|unist)/.test(id)) return 'markdown-vendor'
          if (id.includes('node_modules/framer-motion')) return 'motion-vendor'
          if (id.includes('node_modules/lucide-react')) return 'icons-vendor'
          return undefined
        },
      },
    },
  },
})
