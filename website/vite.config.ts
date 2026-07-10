import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { githubReleasePlugin } from './src/plugins/github-release-plugin'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    githubReleasePlugin({ owner: 'ibraude', repo: 'deepcuts' }),
  ],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../src/shared'),
      // The @shared files live outside website/ and their imports (e.g. `zod`)
      // must resolve from website/node_modules — otherwise builds fail on
      // hosts (Vercel monorepo Root Directory = website) that don't install
      // the main repo's node_modules.
      zod: resolve(__dirname, 'node_modules/zod'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
