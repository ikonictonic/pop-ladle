import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createHardRuleForCurrentUser,
  deleteHardRuleForCurrentUser,
  getHardRuleForCurrentUser,
  listHardRulesForCurrentUser,
  updateHardRuleForCurrentUser,
} from './hardRuleService.js'

export function createHardRuleRouter() {
  const router = Router()

  router.get('/households/:householdId/hard-rules', requireAuthenticatedRequest, async (req, res) => {
    const result = await listHardRulesForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.query,
    )
    res.status(200).json(result)
  })

  router.post('/households/:householdId/hard-rules', requireAuthenticatedRequest, async (req, res) => {
    const result = await createHardRuleForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(201).json(result)
  })

  router.get(
    '/households/:householdId/hard-rules/:hardRuleId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getHardRuleForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.hardRuleId,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    '/households/:householdId/hard-rules/:hardRuleId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateHardRuleForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.hardRuleId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.delete(
    '/households/:householdId/hard-rules/:hardRuleId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await deleteHardRuleForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.hardRuleId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
