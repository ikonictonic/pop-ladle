import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  adoptSavesForCurrentUser,
  listSavesForCurrentUser,
  putSaveForCurrentUser,
  removeSaveForCurrentUser,
} from './accountSavesService.js'

/**
 * Account saves — the signed-in user's saved public-site content.
 *
 * All routes require a Clerk session. The public site itself saves to
 * localStorage as a guest and never calls these; the app calls them once the
 * user is signed in, including the one-time `adopt` that migrates the visitor's
 * device saves into their account.
 */
export function createAccountSavesRouter() {
  const router = Router()

  // The current user's saved items, newest first.
  router.get('/account/saves', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listSavesForCurrentUser(req.authContext.userId))
  })

  // Save (upsert) one item. Body: { type, id, title, img, savedAt? }.
  router.put('/account/saves', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await putSaveForCurrentUser(req.authContext.userId, req.body))
  })

  // Adopt a batch of device saves. Body: { items: [{ type, id, title, img, savedAt? }] }.
  router.post('/account/saves/adopt', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await adoptSavesForCurrentUser(req.authContext.userId, req.body))
  })

  // Remove one save by key (e.g. "recipe:warm-oats"; URL-encode the colon).
  router.delete('/account/saves/:key', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await removeSaveForCurrentUser(req.authContext.userId, req.params.key))
  })

  return router
}
