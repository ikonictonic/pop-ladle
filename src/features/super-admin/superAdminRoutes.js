import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createAdminForAdmin,
  createPrivacyRequestForAdmin,
  getAdminOverview,
  getHouseholdForAdmin,
  getRosterForAdmin,
  listAdminsForAdmin,
  listHouseholdsForAdmin,
  listPlatformAuditLogForAdmin,
  listPrivacyRequestsForAdmin,
  listProxyLogsForAdmin,
  listUsersForAdmin,
  reinstateHouseholdForAdmin,
  suspendHouseholdForAdmin,
  updateAdminForAdmin,
  updateHouseholdEntitlementForAdmin,
  updatePrivacyRequestForAdmin,
  updateRosterEntryForAdmin,
} from './superAdminService.js'

export function createSuperAdminRouter() {
  const router = Router()

  // Dashboard
  router.get('/admin/overview', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await getAdminOverview(req.authContext.userId))
  })

  // Registries
  router.get('/admin/users', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listUsersForAdmin(req.authContext.userId, req.query))
  })

  router.get('/admin/households', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listHouseholdsForAdmin(req.authContext.userId, req.query))
  })

  router.get('/admin/households/:householdId', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await getHouseholdForAdmin(req.authContext.userId, req.params.householdId))
  })

  // Entitlement write surface (comps / tier changes) — super admin
  router.patch(
    '/admin/households/:householdId/entitlement',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(
        await updateHouseholdEntitlementForAdmin(req.authContext.userId, req.params.householdId, req.body),
      )
    },
  )

  // Household lifecycle (fraud / abuse / billing / legal)
  router.post(
    '/admin/households/:householdId/suspend',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(
        await suspendHouseholdForAdmin(req.authContext.userId, req.params.householdId, req.body),
      )
    },
  )

  router.post(
    '/admin/households/:householdId/reinstate',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(
        await reinstateHouseholdForAdmin(req.authContext.userId, req.params.householdId, req.body),
      )
    },
  )

  // Committee roster governance
  router.get('/admin/roster', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await getRosterForAdmin(req.authContext.userId))
  })

  router.patch('/admin/roster/:roleKey', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(
      await updateRosterEntryForAdmin(req.authContext.userId, req.params.roleKey, req.body),
    )
  })

  // Observability
  router.get('/admin/proxy-logs', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listProxyLogsForAdmin(req.authContext.userId, req.query))
  })

  router.get('/admin/audit-log', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listPlatformAuditLogForAdmin(req.authContext.userId, req.query))
  })

  // Privacy request workflows
  router.get('/admin/privacy-requests', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listPrivacyRequestsForAdmin(req.authContext.userId, req.query))
  })

  router.post('/admin/privacy-requests', requireAuthenticatedRequest, async (req, res) => {
    res.status(201).json(await createPrivacyRequestForAdmin(req.authContext.userId, req.body))
  })

  router.patch(
    '/admin/privacy-requests/:requestId',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(
        await updatePrivacyRequestForAdmin(req.authContext.userId, req.params.requestId, req.body),
      )
    },
  )

  // Admin management
  router.get('/admin/admins', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listAdminsForAdmin(req.authContext.userId))
  })

  router.post('/admin/admins', requireAuthenticatedRequest, async (req, res) => {
    res.status(201).json(await createAdminForAdmin(req.authContext.userId, req.body))
  })

  router.patch('/admin/admins/:adminId', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(
      await updateAdminForAdmin(req.authContext.userId, req.params.adminId, req.body),
    )
  })

  return router
}
