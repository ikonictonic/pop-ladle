import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

let pool

export function getDatabasePool() {
  if (!env.DATABASE_URL) return null

  pool ??= new Pool({
    connectionString: env.DATABASE_URL,
    application_name: 'pop-ladle-api',
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  return pool
}

export async function pingDatabase() {
  const db = getDatabasePool()

  if (!db) {
    return {
      ok: false,
      status: 'not_configured',
      reason: 'DATABASE_URL is not set.',
    }
  }

  const started = performance.now()

  try {
    const result = await db.query(`
      select
        current_database() as database_name,
        current_user as database_user,
        now() as server_time
    `)

    return {
      ok: true,
      status: 'ready',
      latencyMs: Math.round(performance.now() - started),
      ...result.rows[0],
    }
  } catch (err) {
    return {
      ok: false,
      status: 'unavailable',
      code: err.code ?? 'DATABASE_CONNECTION_FAILED',
      message: err.message,
    }
  }
}

export async function closeDatabasePool() {
  if (!pool) return

  await pool.end()
  pool = undefined
}
