/**
 * Local dev server. Runs the same Hono app the Vercel function exports,
 * but on Node so we can test without `vercel login`.
 */
import { config as loadEnv } from 'node:process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { app } from '../api/index.js'

// Manually load .env.local — @hono/node-server doesn't do dotenv for us.
const envPath = resolve(import.meta.dirname, '../.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]!] ||= m[2]!
  }
}

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`preview-registry on http://localhost:${info.port}`)
})
