import express from 'express'
import { pingDatabase } from '../database/pool.js'
import { createClerkRequestMiddleware } from '../features/auth/clerk.js'
import { createCurrentUserRouter } from '../features/auth/currentUserRoutes.js'
import { createCareRecipientRouter } from '../features/care-recipients/careRecipientRoutes.js'
import { createHardRuleRouter } from '../features/hard-rules/hardRuleRoutes.js'
import { createHouseholdRouter } from '../features/households/householdRoutes.js'
import { createMemberRouter } from '../features/members/memberRoutes.js'
import { createRecipeRouter } from '../features/recipes/recipeRoutes.js'
import { createRecipeBrainRouter } from '../features/recipe-brain/recipeBrainRoutes.js'
import { createClinicalReviewRouter } from '../features/clinical-review/clinicalReviewRoutes.js'
import { createAuditLogRouter } from '../features/audit-log/auditLogRoutes.js'
import { createPlanRouter } from '../features/plans/planRoutes.js'
import { createSuperAdminRouter } from '../features/super-admin/superAdminRoutes.js'
import { createPlatformRecipeRouter } from '../features/platform-recipes/platformRecipeRoutes.js'
import { createDayPlanRouter } from '../features/day-plan/dayPlanRoutes.js'
import { createHydrationRouter } from '../features/hydration/hydrationRoutes.js'
import { createGroceryRouter } from '../features/grocery/groceryRoutes.js'
import { createNotesRouter } from '../features/notes/notesRoutes.js'
import { createNotificationRouter } from '../features/notifications/notificationRoutes.js'
import { createRequestContextMiddleware } from './requestContext.js'
import { createCorsMiddleware } from './cors.js'

export function createApp() {
  const app = express()
  const startedAt = new Date()

  app.disable('x-powered-by')
  app.use(createCorsMiddleware())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use(createRequestContextMiddleware())
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
        household: '/api/v1/households/:householdId',
        transferOwnership: '/api/v1/households/:householdId/transfer-ownership',
        householdMembers: '/api/v1/households/:householdId/members',
        updateMemberRole: '/api/v1/households/:householdId/members/:memberId/role',
        suspendMember: '/api/v1/households/:householdId/members/:memberId/suspend',
        removeMember: '/api/v1/households/:householdId/members/:memberId/remove',
        householdInvites: '/api/v1/households/:householdId/invites',
        revokeHouseholdInvite: '/api/v1/households/:householdId/invites/:inviteId/revoke',
        resendHouseholdInvite: '/api/v1/households/:householdId/invites/:inviteId/resend',
        acceptInvite: '/api/v1/invites/accept',
        careRecipients: '/api/v1/households/:householdId/care-recipients',
        careRecipient: '/api/v1/households/:householdId/care-recipients/:careRecipientId',
        careProfile: '/api/v1/households/:householdId/care-recipients/:careRecipientId/profile',
        clinicalProfileTemplate: '/api/v1/clinical-profile-template',
        clinicalProfile: '/api/v1/households/:householdId/care-recipients/:careRecipientId/clinical-profile',
        clinicalProfileSection: '/api/v1/households/:householdId/care-recipients/:careRecipientId/clinical-profile/sections/:sectionKey',
        hardRules: '/api/v1/households/:householdId/hard-rules',
        hardRule: '/api/v1/households/:householdId/hard-rules/:hardRuleId',
        recipes: '/api/v1/households/:householdId/recipes',
        recipe: '/api/v1/households/:householdId/recipes/:recipeId',
        recipePhotoUploadUrl: '/api/v1/households/:householdId/recipes/:recipeId/photo/upload-url',
        recipePhoto: '/api/v1/households/:householdId/recipes/:recipeId/photo',
        recipeBrainRuns: '/api/v1/households/:householdId/recipe-brain/runs',
        recipeBrainRun: '/api/v1/households/:householdId/recipe-brain/runs/:runId',
        clinicalReview: '/api/v1/households/:householdId/clinical-review',
        clinicalReviewRecipe: '/api/v1/households/:householdId/clinical-review/:recipeId',
        clinicalReviewDecision: '/api/v1/households/:householdId/clinical-review/:recipeId/decision',
        clinicalReviewAccuracyCheck: '/api/v1/households/:householdId/clinical-review/:recipeId/accuracy-check',
        auditLog: '/api/v1/households/:householdId/audit-log',
        plans: '/api/v1/plans',
        householdPlan: '/api/v1/households/:householdId/plan',
        admin: '/api/v1/admin/* (overview, users, households, roster, proxy-logs, audit-log, privacy-requests, admins)',
        platformRecipes: '/api/v1/platform-recipes',
        platformRecipe: '/api/v1/platform-recipes/:recipeId',
        copyPlatformRecipe: '/api/v1/households/:householdId/platform-recipes/:recipeId/copy',
        publishRecipe: '/api/v1/admin/recipes/:recipeId/publish',
        dayPlan: '/api/v1/households/:householdId/care-recipients/:careRecipientId/day-plan',
        dayPlanEntry: '/api/v1/households/:householdId/day-plan/:entryId',
        hydration: '/api/v1/households/:householdId/care-recipients/:careRecipientId/hydration',
        hydrationLog: '/api/v1/households/:householdId/hydration/:logId',
        groceryList: '/api/v1/households/:householdId/grocery-list',
        groceryGenerate: '/api/v1/households/:householdId/grocery-list/generate',
        groceryItem: '/api/v1/households/:householdId/grocery-list/items/:itemId',
        notes: '/api/v1/households/:householdId/care-recipients/:careRecipientId/notes',
        note: '/api/v1/households/:householdId/notes/:noteId',
        rejectionRouting: '/api/v1/households/:householdId/care-recipients/:careRecipientId/rejection-routing',
        notifications: '/api/v1/notifications',
        notificationUnreadCount: '/api/v1/notifications/unread-count',
        notification: '/api/v1/notifications/:notificationId',
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
  app.use('/api/v1', createHardRuleRouter())
  app.use('/api/v1', createRecipeRouter())
  app.use('/api/v1', createRecipeBrainRouter())
  app.use('/api/v1', createClinicalReviewRouter())
  app.use('/api/v1', createAuditLogRouter())
  app.use('/api/v1', createPlanRouter())
  app.use('/api/v1', createSuperAdminRouter())
  app.use('/api/v1', createPlatformRecipeRouter())
  app.use('/api/v1', createDayPlanRouter())
  app.use('/api/v1', createHydrationRouter())
  app.use('/api/v1', createGroceryRouter())
  app.use('/api/v1', createNotesRouter())
  app.use('/api/v1', createNotificationRouter())

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
