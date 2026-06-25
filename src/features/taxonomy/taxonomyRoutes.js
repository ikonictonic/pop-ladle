import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createTaxonomyForCurrentUser,
  deleteTaxonomyForCurrentUser,
  getTaxonomyUsageForCurrentUser,
  listTaxonomyForCurrentUser,
  updateTaxonomyForCurrentUser,
} from './taxonomyService.js'

export function createTaxonomyRouter() {
  const router = Router()

  router.get('/households/:householdId/taxonomy', requireAuthenticatedRequest, async (req, res) => {
    const result = await listTaxonomyForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.query,
    )
    res.status(200).json(result)
  })

  // Static sub-path before any ':taxonomyId' route so it is never shadowed.
  router.get('/households/:householdId/taxonomy/in-use', requireAuthenticatedRequest, async (req, res) => {
    const result = await getTaxonomyUsageForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.query,
    )
    res.status(200).json(result)
  })

  router.post('/households/:householdId/taxonomy', requireAuthenticatedRequest, async (req, res) => {
    const result = await createTaxonomyForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(201).json(result)
  })

  router.patch(
    '/households/:householdId/taxonomy/:taxonomyId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateTaxonomyForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.taxonomyId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.delete(
    '/households/:householdId/taxonomy/:taxonomyId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await deleteTaxonomyForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.taxonomyId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
