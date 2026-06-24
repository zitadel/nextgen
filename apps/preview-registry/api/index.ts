import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { list } from '@vercel/blob'
import { x as untar } from 'tar'

export const config = { runtime: 'nodejs22.x' }

const branchFromHost = (host: string): string => {
  const m = host.match(/-git-([a-z0-9-]+?)(?:-[a-z0-9]+)?\.vercel\.app$/)
  if (m) return m[1]!
  if (host.startsWith('localhost')) return 'local'
  return 'main'
}

const readManifestAndIntegrity = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const shasum = createHash('sha1').update(buf).digest('hex')
  const integrity = 'sha512-' + createHash('sha512').update(buf).digest('base64')

  let manifest: any
  await new Promise<void>((resolve, reject) => {
    const parser = untar({
      filter: (p) => p === 'package/package.json',
      onentry: (entry) => {
        const chunks: Buffer[] = []
        entry.on('data', (d: Buffer) => chunks.push(d))
        entry.on('end', () => {
          manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        })
      },
    })
    Readable.from(buf).pipe(parser).on('finish', () => resolve()).on('error', reject)
  })
  if (!manifest) throw new Error(`no package.json in ${url}`)
  return { manifest, shasum, integrity, size: buf.length }
}

const buildPackument = async (scope: string, name: string, host: string) => {
  const branch = branchFromHost(host)
  const prefix = `branch-${branch}/${scope}/${name}/-/`
  const { blobs } = await list({ prefix })

  const versions: Record<string, any> = {}
  let latest: string | undefined
  let latestTime = 0

  await Promise.all(
    blobs
      .filter((b) => b.pathname.endsWith('.tgz'))
      .map(async (b) => {
        const { manifest, shasum, integrity, size } = await readManifestAndIntegrity(b.url)
        versions[manifest.version] = {
          ...manifest,
          dist: { tarball: b.url, shasum, integrity, unpackedSize: size },
        }
        const t = new Date(b.uploadedAt).getTime()
        if (t > latestTime) {
          latestTime = t
          latest = manifest.version
        }
      })
  )

  if (Object.keys(versions).length === 0) return null
  return {
    name: `${scope}/${name}`,
    'dist-tags': latest ? { latest } : {},
    versions,
  }
}

export const app = new Hono()

app.get('/:scope{@[^/]+}/:name', async (c) => {
  const packument = await buildPackument(
    c.req.param('scope'),
    c.req.param('name'),
    c.req.header('host') ?? 'localhost'
  )
  if (!packument) return c.json({ error: 'not found' }, 404)
  c.header('Cache-Control', 's-maxage=60, stale-while-revalidate=86400')
  return c.json(packument)
})

// URL-encoded scope variant (npm CLI uses %2f / %2F instead of /)
app.get('/:full{@[^/]+%2[Ff][^/]+}', async (c) => {
  const decoded = decodeURIComponent(c.req.param('full'))
  const [scope, name] = decoded.split('/')
  if (!scope || !name) return c.json({ error: 'bad path' }, 400)
  const packument = await buildPackument(scope, name, c.req.header('host') ?? 'localhost')
  if (!packument) return c.json({ error: 'not found' }, 404)
  c.header('Cache-Control', 's-maxage=60, stale-while-revalidate=86400')
  return c.json(packument)
})

app.get('/-/ping', (c) => c.text('OK'))
app.get('/', (c) => c.json({ ok: true, registry: 'zitadel preview' }))

export default handle(app)
