/**
 * Throwaway R2 end-to-end smoke test. Exercises the real storageClient.js:
 * presign PUT -> upload -> head -> presign GET -> download -> delete.
 * Run: node --env-file-if-exists=.env scripts/r2-smoke-test.js
 */
import {
  isStorageConfigured,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  deleteObject,
  headObject,
} from '../src/integrations/storage/storageClient.js'

const key = `smoke-tests/${Date.now()}-r2-check.txt`
const body = 'pop-and-ladle r2 smoke test'
const contentType = 'text/plain'

function ok(label) { console.log(`  ✓ ${label}`) }

async function main() {
  console.log('R2 smoke test')
  if (!isStorageConfigured()) {
    console.error('  ✗ isStorageConfigured() === false — check S3_* env vars')
    process.exit(1)
  }
  ok('isStorageConfigured() === true')

  // 1. presign PUT + upload directly to the bucket
  const putUrl = await createPresignedUploadUrl({ key, contentType, expiresIn: 300 })
  ok('createPresignedUploadUrl() returned a URL')
  const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body })
  if (!put.ok) throw new Error(`PUT failed: ${put.status} ${await put.text()}`)
  ok(`uploaded object via presigned PUT (HTTP ${put.status})`)

  // 2. head — server-side existence check used by confirmUpload
  const head = await headObject({ key })
  if (!head) throw new Error('headObject returned null right after upload')
  ok(`headObject() found it (contentLength=${head.contentLength}, contentType=${head.contentType})`)

  // 3. presign GET + download, verify round-trip bytes
  const getUrl = await createPresignedDownloadUrl({ key, expiresIn: 300 })
  const get = await fetch(getUrl)
  if (!get.ok) throw new Error(`GET failed: ${get.status}`)
  const got = await get.text()
  if (got !== body) throw new Error(`round-trip mismatch: got "${got}"`)
  ok('downloaded via presigned GET — bytes match')

  // 4. cleanup
  await deleteObject({ key })
  const headAfter = await headObject({ key })
  if (headAfter) throw new Error('object still present after delete')
  ok('deleteObject() removed it')

  console.log('\nALL PASSED — R2 is correctly wired.')
}

main().catch((err) => {
  console.error('\n✗ FAILED:', err?.message || err)
  process.exit(1)
})
