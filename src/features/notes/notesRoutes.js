import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createNoteForCurrentUser,
  getRejectionRoutingForCurrentUser,
  listNotesForCurrentUser,
  removeNoteForCurrentUser,
  updateNoteForCurrentUser,
} from './notesService.js'

export function createNotesRouter() {
  const router = Router()

  // Caregiver notes timeline for a care recipient (?category=&limit=).
  router.get(
    '/households/:householdId/care-recipients/:careRecipientId/notes',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(await listNotesForCurrentUser(
        req.authContext.userId, req.params.householdId, req.params.careRecipientId, req.query,
      ))
    },
  )

  router.post(
    '/households/:householdId/care-recipients/:careRecipientId/notes',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(201).json(await createNoteForCurrentUser(
        req.authContext.userId, req.params.householdId, req.params.careRecipientId, req.body,
      ))
    },
  )

  // Rejection Routing: recent refusals + suggested alternate recipes.
  router.get(
    '/households/:householdId/care-recipients/:careRecipientId/rejection-routing',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(await getRejectionRoutingForCurrentUser(
        req.authContext.userId, req.params.householdId, req.params.careRecipientId,
      ))
    },
  )

  router.patch(
    '/households/:householdId/notes/:noteId',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(await updateNoteForCurrentUser(
        req.authContext.userId, req.params.householdId, req.params.noteId, req.body,
      ))
    },
  )

  router.delete(
    '/households/:householdId/notes/:noteId',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(await removeNoteForCurrentUser(
        req.authContext.userId, req.params.householdId, req.params.noteId,
      ))
    },
  )

  return router
}
