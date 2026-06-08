import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  CLINICAL_PROFILE_SECTIONS,
  createEmptyClinicalProfileData,
} from '../clinical-profiles/clinicalProfileSchema.js'
import {
  CARE_PROFILE_REVIEW_STATUSES,
  createCareRecipientForCurrentUser,
  getCareProfileForCurrentUser,
  getCareRecipientForCurrentUser,
  listCareRecipientsForCurrentUser,
  updateCareProfileForCurrentUser,
  updateCareProfileSectionForCurrentUser,
  updateCareRecipientForCurrentUser,
} from './careRecipientService.js'

export function createCareRecipientRouter() {
  const router = Router()

  router.get('/clinical-profile-template', requireAuthenticatedRequest, async (_req, res) => {
    res.status(200).json({
      sections: CLINICAL_PROFILE_SECTIONS,
      sectionKeys: CLINICAL_PROFILE_SECTIONS.map((section) => section.key),
      reviewStatuses: CARE_PROFILE_REVIEW_STATUSES,
      emptyProfileData: createEmptyClinicalProfileData(),
    })
  })

  router.get(
    '/households/:householdId/care-recipients',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listCareRecipientsForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/care-recipients',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await createCareRecipientForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.get(
    '/households/:householdId/care-recipients/:careRecipientId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getCareRecipientForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    '/households/:householdId/care-recipients/:careRecipientId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateCareRecipientForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.get(
    [
      '/households/:householdId/care-recipients/:careRecipientId/profile',
      '/households/:householdId/care-recipients/:careRecipientId/clinical-profile',
    ],
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getCareProfileForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    [
      '/households/:householdId/care-recipients/:careRecipientId/profile',
      '/households/:householdId/care-recipients/:careRecipientId/clinical-profile',
    ],
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateCareProfileForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    [
      '/households/:householdId/care-recipients/:careRecipientId/profile/sections/:sectionKey',
      '/households/:householdId/care-recipients/:careRecipientId/clinical-profile/sections/:sectionKey',
    ],
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateCareProfileSectionForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.params.sectionKey,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  return router
}
