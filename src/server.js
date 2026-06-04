import { createServer } from 'node:http'
import { createApp } from './app/createApp.js'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number.parseInt(process.env.PORT ?? '3000', 10)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a valid TCP port. Received: ${process.env.PORT}`)
}

const app = createApp()
const server = createServer(app)

server.listen(port, host, () => {
  const localHost = host === '0.0.0.0' ? 'localhost' : host
  console.log(JSON.stringify({
    level: 'info',
    message: 'Pop & Ladle API listening',
    url: `http://${localHost}:${port}`,
    node: process.version,
    env: process.env.NODE_ENV ?? 'development',
  }))
})

function shutdown(signal) {
  console.log(JSON.stringify({
    level: 'info',
    message: 'Stopping Pop & Ladle API',
    signal,
  }))

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
