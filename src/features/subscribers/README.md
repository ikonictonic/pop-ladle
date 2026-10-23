# Early-access subscribers

Backend for the popladle.com signup form, the thank-you page interest question,
email confirmation, preferences/unsubscribe, and Plunk sync. Spec: the
"Subscriber Preference Capture" developer handoff (October 2026). The public
site proxies `/api/early-access`, `/api/subscriber/*` and `/api/contact` here,
so the browser only ever talks to popladle.com.

## Endpoints

All mounted before the frontend gate and Clerk; none read `req.authContext`.

| Route | Auth | Does |
|---|---|---|
| `POST /api/v1/early-access` | rate limit + honeypot | Records a pending signup with consent evidence, emails the confirmation link, returns a 2-hour `signup_session` |
| `POST /api/v1/subscriber/preference` | `signup_session` or `manage_token` | Saves `primary_interest`; never changes subscription state |
| `POST /api/v1/subscriber/confirm` | emailed token (single use, 48 h) | Confirms, subscribes the Plunk contact, sends the planner email once, starts the meal-planning workflow |
| `POST /api/v1/subscriber/withdraw` | `manage_token` (body or `?token=`) | Withdraws and unsubscribes in Plunk. Also takes RFC 8058 one-click POSTs |
| `POST /api/v1/subscriber/plunk-events?event=…` | `Authorization: Bearer PLUNK_WEBHOOK_SECRET` | Reconciles `contact.subscribed`, `contact.unsubscribed`, `email.bounce`, `email.complaint` |
| `POST /api/v1/contact` | rate limit + honeypot | Emails the message to `CONTACT_INBOX` (still through Resend); not stored, not a subscription |

## Consent rules

- `email_subscribers` is the source of truth; `email_subscriber_events` is the
  append-only history (the trigger rejects updates).
- Sending the confirmation email makes the address a Plunk contact with
  `subscribed: false`. Only confirmation subscribes it, so campaigns and
  workflows never reach an unconfirmed address. Plunk bills per email sent,
  not per contact.
- A repeated signup never clears a withdrawal or suppression. Only a new
  confirmation re-subscribes a withdrawn address; nothing re-subscribes a
  suppressed one.
- Webhook deliveries are de-duplicated by Plunk execution id, and contact
  events older than the latest consent change are ignored, so our own Plunk
  updates echoing back are harmless.
- Aggregate reporting: `select * from email_subscriber_metrics`.

## Plunk setup (next-app.useplunk.com)

1. Settings → API Keys: put the secret key in `PLUNK_SECRET_KEY` and the
   public key in `PLUNK_PUBLIC_KEY` (`/v1/track` takes only the public key).
2. Domains: verify popladle.com and set `SUBSCRIBER_EMAIL_FROM`, e.g.
   `Pop & Ladle <hello@popladle.com>`. Contact `data` fields (`primary_interest`,
   `interest_source`, `interest_updated_at`, `signup_source`, `signup_locale`,
   `onboarding_stage`) are created on first use; nothing to define.
3. Optional: a dynamic segment "Early access" where `signup_source` is
   `early_access_landing`.
4. Meal-planning workflow: trigger on the event `meal_planning.started` →
   delay 4 days → "A little planning for the week ahead." → delay 5 days →
   "One meal, a few ways to serve it." Use Marketing templates: Plunk adds the
   unsubscribe footer and skips unsubscribed contacts. Leave re-entry off.
5. Webhook workflows, one per trigger: `contact.unsubscribed`,
   `contact.subscribed`, `email.bounce`, `email.complaint`. Each has one
   Webhook step: POST `https://<api-host>/api/v1/subscriber/plunk-events?event=<trigger>`,
   header `{"Authorization": "Bearer <PLUNK_WEBHOOK_SECRET>"}`, no custom body.
   Turn **re-entry on** for all four, or a contact who unsubscribes twice only
   reaches us once. Plunk does not retry a failed step; check failures in the
   workflow's execution log.
