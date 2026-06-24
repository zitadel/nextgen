/**
 * Local end-to-end driver:
 *   1. pnpm publish --dry-run --pack-destination → tarball for a workspace pkg
 *   2. put() the tarball into the blob emulator under the same key shape the
 *      production reader will list (branch-<ref>/@scope/name/-/<file>.tgz)
 *
 * Run with the emulator already up on http://localhost:3100. The .env.local
 * picked up here matches what `vercel dev` will use, so the function reads
 * exactly what this script wrote.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { x as untar } from 'tar'
import { put } from '@vercel/blob'

// Point the SDK at the local emulator. The token value is arbitrary; the
// emulator does no auth, it just needs the env var to be set.
process.env.BLOB_READ_WRITE_TOKEN ||= 'vercel_blob_rw_emulator_local'
process.env.VERCEL_BLOB_API_URL ||= 'http://localhost:3100/api/blob'

// Smallest packages to keep the loop fast. We're testing the registry shape,
// not the SDK content.
const REPO = resolve(import.meta.dirname, '../../..')
const PACKAGES = [
  'packages/sdk-core',
  'packages/sdk-react',
]
const BRANCH = process.env.LOCAL_BRANCH ?? 'local'

const readManifestFromTgz = async (path: string) => {
  const buf = readFileSync(path)
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
  return manifest
}

const out = mkdtempSync(join(tmpdir(), 'preview-stage-'))
try {
  for (const dir of PACKAGES) {
    console.log(`packing ${dir}...`)
    execFileSync(
      'pnpm',
      ['pack', `--pack-destination=${out}`],
      { cwd: join(REPO, dir), stdio: 'inherit' }
    )
  }

  const tgzs = readdirSync(out).filter((f) => f.endsWith('.tgz'))
  console.log(`uploading ${tgzs.length} tarballs to blob emulator...`)
  for (const f of tgzs) {
    const path = join(out, f)
    const manifest = await readManifestFromTgz(path)
    const key = `branch-${BRANCH}/${manifest.name}/-/${f}`
    const blob = await put(key, readFileSync(path), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
      allowOverwrite: true,
    })
    console.log(`  ${manifest.name}@${manifest.version} → ${blob.url}`)
  }
  console.log('\nstaged. now run: pnpm dev')
  console.log(`then: curl http://localhost:3000/@zitadel/sdk-core`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
