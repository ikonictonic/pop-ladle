import express from 'express'

export function createApp() {
  const app = express()
  const startedAt = new Date()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false }))

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'Pop & Ladle API',
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
      endpoints: {
        health: '/health',
        apiHealth: '/api/v1/health',
        readiness: '/api/v1/ready',
      },
    })
  })

  app.get(['/health', '/api/v1/health'], (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'pop-ladle-api',
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: startedAt.toISOString(),
    })
  })

  app.get('/api/v1/ready', (_req, res) => {
    res.status(200).json({
      status: 'ready',
      database: 'not_configured_yet',
    })
  })

  app.use('/api/v1', (req, res) => {
    res.status(404).json({
      error: {
        code: 'API_ROUTE_NOT_FOUND',
        message: `No API route registered for ${req.method} ${req.originalUrl}`,
      },
    })
  })

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No route registered for ${req.method} ${req.originalUrl}`,
      },
    })
  })

  app.use((err, _req, res, _next) => {
    console.error(err)
    res.status(err.statusCode ?? 500).json({
      error: {
        code: err.code ?? 'INTERNAL_SERVER_ERROR',
        message: err.expose ? err.message : 'Something went wrong.',
      },
    })
  })

  return app
}
