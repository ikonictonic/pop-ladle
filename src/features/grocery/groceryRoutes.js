import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  addGroceryItemForCurrentUser,
  clearGroceryListForCurrentUser,
  generateGroceryListFromPlanForCurrentUser,
  getGroceryListForCurrentUser,
  removeGroceryItemForCurrentUser,
  updateGroceryItemForCurrentUser,
} from './groceryService.js'

export function createGroceryRouter() {
  const router = Router()

  // The list (?careRecipientId= for a recipient scope; omit for household-wide).
  router.get('/households/:householdId/grocery-list', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await getGroceryListForCurrentUser(req.authContext.userId, req.params.householdId, req.query))
  })

  // Build the list from the Day Plan in a date range.
  router.post('/households/:householdId/grocery-list/generate', requireAuthenticatedRequest, async (req, res) => {
    res.status(201).json(await generateGroceryListFromPlanForCurrentUser(req.authContext.userId, req.params.householdId, req.body))
  })

  // Add a manual item.
  router.post('/households/:householdId/grocery-list/items', requireAuthenticatedRequest, async (req, res) => {
    res.status(201).json(await addGroceryItemForCurrentUser(req.authContext.userId, req.params.householdId, req.body))
  })

  // Check/uncheck, edit, or reorder an item.
  router.patch('/households/:householdId/grocery-list/items/:itemId', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await updateGroceryItemForCurrentUser(req.authContext.userId, req.params.householdId, req.params.itemId, req.body))
  })

  router.delete('/households/:householdId/grocery-list/items/:itemId', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await removeGroceryItemForCurrentUser(req.authContext.userId, req.params.householdId, req.params.itemId))
  })

  // Clear all (or ?checkedOnly=true) in scope.
  router.delete('/households/:householdId/grocery-list', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await clearGroceryListForCurrentUser(req.authContext.userId, req.params.householdId, req.query))
  })

  return router
}
