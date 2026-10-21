# Early-access subscribers

Backend for the popladle.com signup form, the thank-you page interest question,
email confirmation, preferences/unsubscribe, and Resend sync. Spec: the
"Subscriber Preference Capture" developer handoff (October 2026). The public
site proxies `/api/early-access`, `/api/subscriber/*` and `/api/contact` here,
so the browser only ever talks to popladle.com.

## Endpoints

All mounted before the frontend gate and Clerk; none read `req.authContext`.

| Route | Auth | Does |
|---|---|---|
| `POST /api/v1/early-access` | rate limit + honeypot | Records a pending signup with consent evidence, emails the confirmation link, returns a 2-hour `signup_session` |
| `POST /api/v1/subscriber/preference` | `signup_session` or `manage_token` | Saves `primary_interest`; never changes subscription state |
| `POST /api/v1/subscriber/confirm` | emailed token (single use, 48 h) | Confirms, creates the Resend contact, sends the planner email once, starts the meal-planning automation |
| `POST /api/v1/subscriber/withdraw` | `manage_token` (body or `?token=`) | Withdraws and unsubscribes in Resend. Also takes RFC 8058 one-click POSTs |
| `POST /api/v1/subscriber/resend-events` | Svix signature | Reconciles `contact.updated`, `email.bounced`, `email.complained`, `email.suppressed` |
| `POST /api/v1/contact` | rate limit + honeypot | Emails the message to `CONTACT_INBOX`; not stored, not a subscription |

## Consent rules

- `email_subscribers` is the source of truth; `email_subscriber_events` is the
  append-only history (the trigger rejects updates).
- A pending address never reaches Resend. The contact is created on
  confirmation, which also keeps unconfirmed addresses off the paid contact count.
- A repeated signup never clears a withdrawal or suppression. Only a new
  confirmation re-subscribes a withdrawn address; nothing re-subscribes a
  suppressed one.
- Webhook deliveries are de-duplicated by `svix-id`, and contact events older
  than the latest consent change are ignored, so our own Resend updates echoing
  back are harmless.
- Aggregate reporting: `select * from email_subscriber_metrics`.

## Resend setup

1. Verify the sending domain and set `SUBSCRIBER_EMAIL_FROM`.
2. Contacts → Properties: create the string properties `primary_interest`,
   `interest_source`, `interest_updated_at`, `signup_source`, `signup_locale`,
   `onboarding_stage`. Resend rejects updates that use undefined properties.
3. Optional: create an "Early access" segment and set `RESEND_SEGMENT_ID`.
4. Automations: trigger on the custom event `meal_planning.started` → delay
   4 days → "A little planning for the week ahead." → delay 5 days → "One meal,
   a few ways to serve it." Put `{{{RESEND_UNSUBSCRIBE_URL}}}` in both emails.
   Before launch, confirm that automation sends skip contacts with
   `unsubscribed: true`; Resend's docs do not state it.
5. Webhooks: add `https://<api-host>/api/v1/subscriber/resend-events` with
   `contact.updated`, `email.bounced`, `email.complained`, `email.suppressed`,
   and put its signing secret in `RESEND_WEBHOOK_SECRET`.
