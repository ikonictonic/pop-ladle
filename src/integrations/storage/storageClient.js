/**
 * Object storage adapter (S3-compatible — built for Cloudflare R2).
 *
 * Private bucket: objects are never publicly readable. Uploads use presigned
 * PUT URLs (client uploads straight to the bucket, off the Express server) and
 * reads use short-lived presigned GET URLs. Presigning is local HMAC — no
 * network call — so it is cheap.
 *
 * Credentials live in env vars only. When unconfigured, isStorageConfigured()
 * is false and callers surface a 503 rather than crashing at boot — same
 * graceful-degradation pattern as the database and email integrations.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../../config/env.js'

let cachedClient = null

export function isStorageConfigured() {
  return Boolean(
    env.S3_ENDPOINT
      && env.S3_BUCKET
      && env.S3_ACCESS_KEY_ID
      && env.S3_SECRET_ACCESS_KEY,
  )
}

function getClient() {
  if (!isStorageConfigured()) return null
  if (cachedClient) return cachedClient

  cachedClient = new S3Client({
    region: env.S3_REGION || 'auto',
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  })
  return cachedClient
}

/** Presigned PUT URL the client uses to upload directly to the bucket. */
export async function createPresignedUploadUrl({ key, contentType, expiresIn = 300 }) {
  const client = getClient()
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(client, command, { expiresIn })
}

/** Short-lived presigned GET URL for reading a private object. */
export async function createPresignedDownloadUrl({ key, expiresIn = 900 }) {
  const client = getClient()
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  })
  return getSignedUrl(client, command, { expiresIn })
}

export async function deleteObject({ key }) {
  const client = getClient()
  await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
}

/** Returns object metadata, or null if it does not exist. */
export async function headObject({ key }) {
  const client = getClient()
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
    return { contentLength: result.ContentLength ?? null, contentType: result.ContentType ?? null }
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null
    throw err
  }
}
