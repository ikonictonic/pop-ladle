import express from 'express'
import { pingDatabase } from '../database/pool.js'
import { createClerkRequestMiddleware } from '../features/auth/clerk.js'
import { createCurrentUserRouter } from '../features/auth/currentUserRoutes.js'
import { createCareRecipientRouter } from '../features/care-recipients/careRecipientRoutes.js'
import { createHouseholdRouter } from '../features/households/householdRoutes.js'
import { createMemberRouter } from '../features/members/memberRoutes.js'
import { createRecipeRouter } from '../features/recipes/recipeRoutes.js'
import { createRecipeBrainRouter } from '../features/recipe-brain/recipeBrainRoutes.js'

export function createApp() {
  const app = express()
  const startedAt = new Date()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use(createClerkRequestMiddleware())

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'Pop & Ladle API',
      status: 'ok',
      version: process.env.npm_package_version ?? '0.1.0',
      endpoints: {
        health: '/health',
        apiHealth: '/api/v1/health',
        readiness: '/api/v1/ready',
        me: '/api/v1/me',
        households: '/api/v1/households',
        householdMembers: '/api/v1/households/:householdId/members',
        updateMemberRole: '/api/v1/households/:householdId/members/:memberId/role',
        suspendMember: '/api/v1/households/:householdId/members/:memberId/suspend',
        removeMember: '/api/v1/households/:householdId/members/:memberId/remove',
        householdInvites: '/api/v1/households/:householdId/invites',
        revokeHouseholdInvite: '/api/v1/households/:householdId/invites/:inviteId/revoke',
        acceptInvite: '/api/v1/invites/accept',
        careRecipients: '/api/v1/households/:householdId/care-recipients',
        careRecipient: '/api/v1/households/:householdId/care-recipients/:careRecipientId',
        careProfile: '/api/v1/households/:householdId/care-recipients/:careRecipientId/profile',
        recipes: '/api/v1/households/:householdId/recipes',
        recipe: '/api/v1/households/:householdId/recipes/:recipeId',
        recipeBrainRuns: '/api/v1/households/:householdId/recipe-brain/runs',
        recipeBrainRun: '/api/v1/households/:householdId/recipe-brain/runs/:runId',
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

  app.get('/api/v1/ready', async (_req, res) => {
    const database = await pingDatabase()

    res.status(database.ok ? 200 : 503).json({
      status: database.ok ? 'ready' : 'not_ready',
      database,
    })
  })

  app.use('/api/v1', createCurrentUserRouter())
  app.use('/api/v1', createHouseholdRouter())
  app.use('/api/v1', createMemberRouter())
  app.use('/api/v1', createCareRecipientRouter())
  app.use('/api/v1', createRecipeRouter())
  app.use('/api/v1', createRecipeBrainRouter())

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
