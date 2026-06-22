import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  dismissNotificationForCurrentUser,
  getUnreadCountForCurrentUser,
  listNotificationsForCurrentUser,
  markAllNotificationsReadForCurrentUser,
  markNotificationReadForCurrentUser,
} from './notificationService.js'

export function createNotificationRouter() {
  const router = Router()

  // The current user's inbox (?unreadOnly=true&householdId=&limit=).
  router.get('/notifications', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listNotificationsForCurrentUser(req.authContext.userId, req.query))
  })

  // Badge count.
  router.get('/notifications/unread-count', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await getUnreadCountForCurrentUser(req.authContext.userId))
  })

  // Mark all read (optionally scoped to one household).
  router.post('/notifications/read-all', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await markAllNotificationsReadForCurrentUser(req.authContext.userId, req.body))
  })

  router.patch('/notifications/:notificationId/read', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await markNotificationReadForCurrentUser(req.authContext.userId, req.params.notificationId))
  })

  router.delete('/notifications/:notificationId', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await dismissNotificationForCurrentUser(req.authContext.userId, req.params.notificationId))
  })

  return router
}
