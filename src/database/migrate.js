import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDatabasePool, closeDatabasePool } from './pool.js'

const MIGRATION_LOCK_ID = 827_120_401

const currentFile = fileURLToPath(import.meta.url)
const migrationsDir = path.join(path.dirname(currentFile), 'migrations')

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id bigserial primary key,
      filename text not null unique,
      applied_at timestamptz not null default now()
    )
  `)
}

async function listMigrationFiles() {
  const entries = await readdir(migrationsDir, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
}

async function listAppliedMigrations(client) {
  const result = await client.query('select filename from schema_migrations order by filename')
  return new Set(result.rows.map((row) => row.filename))
}

async function applyMigration(client, filename) {
  const sql = await readFile(path.join(migrationsDir, filename), 'utf8')

  await client.query('begin')
  try {
    await client.query(sql)
    await client.query('insert into schema_migrations (filename) values ($1)', [filename])
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  }
}

async function migrate() {
  const pool = getDatabasePool()
  if (!pool) throw new Error('DATABASE_URL is required to run migrations.')

  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await ensureMigrationTable(client)

    const files = await listMigrationFiles()
    const applied = await listAppliedMigrations(client)
    const pending = files.filter((file) => !applied.has(file))

    if (pending.length === 0) {
      console.log('No pending migrations.')
      return
    }

    for (const file of pending) {
      console.log(`Applying ${file}`)
      await applyMigration(client, file)
    }

    console.log(`Applied ${pending.length} migration${pending.length === 1 ? '' : 's'}.`)
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {})
    client.release()
    await closeDatabasePool()
  }
}

migrate().catch(async (err) => {
  console.error(err)
  await closeDatabasePool()
  process.exit(1)
})
