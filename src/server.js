import { createServer } from 'node:http'
import { createApp } from './app/createApp.js'
import { env } from './config/env.js'
import { closeDatabasePool } from './database/pool.js'

const app = createApp()
const server = createServer(app)

server.listen(env.PORT, env.HOST, () => {
  const localHost = env.HOST === '0.0.0.0' ? 'localhost' : env.HOST
  console.log(JSON.stringify({
    level: 'info',
    message: 'Pop & Ladle API listening',
    url: `http://${localHost}:${env.PORT}`,
    node: process.version,
    env: env.NODE_ENV,
  }))
})

async function shutdown(signal) {
  console.log(JSON.stringify({
    level: 'info',
    message: 'Stopping Pop & Ladle API',
    signal,
  }))

  await closeDatabasePool()

  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }

    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
