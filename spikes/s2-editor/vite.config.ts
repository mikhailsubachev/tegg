/// <reference types="vitest/config" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const FIXTURES = resolve(import.meta.dirname, '../../tests/fixtures/format/roundtrip')

// Serves the round-trip fixtures byte-exact: GET /fixtures → JSON list, /fixtures/<path> → raw bytes.
function fixtures(): Plugin {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
  return {
    name: 'tegg-fixtures',
    configureServer(server) {
      server.middlewares.use('/fixtures', (req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '')
        if (!path) {
          const list = walk(FIXTURES).filter((p) => p.endsWith('.md') && !p.endsWith('README.md')).map((p) => relative(FIXTURES, p)).sort()
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify(list))
        }
        const file = resolve(FIXTURES, path)
        if (!file.startsWith(FIXTURES + '/')) { res.statusCode = 403; return res.end() }
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), fixtures()],
  resolve: { alias: { '@core': resolve(import.meta.dirname, '../s1-roundtrip/src') } },
  server: { port: 5174, strictPort: true },
  test: { environment: 'jsdom', testTimeout: 60_000, include: ['test/**/*.test.ts'] },
})
