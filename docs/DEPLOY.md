# Deploying

Phase 1 (the free tools) comes first; [Phase 2](#phase-2-secret-shopper) adds the Secret Shopper on the same app.

## Phase 1

This guide takes the app from this repo to a live site on Google Cloud Run. Plan on 2–3 hours the first time. A
contractor can do it, but you'll need to create the accounts yourself, since they hold your billing and business details.

### 1. Accounts to create (you)

| Service | What it's for | Cost at launch |
|---|---|---|
| **Google Cloud** (with a billing account) | Hosting (Cloud Run), Places API, PageSpeed | Free tiers cover early use; set a budget alert |
| **Neon** (or Cloud SQL) | Postgres database | Free tier to start |
| **Resend** | Sending email | Free tier to start |
| **Cloudflare** | Turnstile bot protection (free) | Free |
| **Anthropic** | Claude API for the Reply Checker's AI review | Pay per use (cents per check) |
| A domain name | Your site address, e.g. `yourbrand.com` | ~$15/year |

### 2. Get the keys

1. **Google Cloud:**
   - Create a project.
   - Enable **Places API (New)** and **PageSpeed Insights API**.
   - Create an API key and restrict it to those two APIs.
   - Under Billing → Budgets, add a monthly budget with email alerts (e.g., $50).
   - Under each API's Quotas page, set a daily cap as a hard backstop.
2. **Neon:** create a project and copy the connection string (`postgres://…`).
3. **Resend:**
   - Add your domain and publish the DNS records it shows (SPF and DKIM), so your email isn't marked as spam.
   - Create an API key.
4. **Cloudflare Turnstile:** add a widget for your domain and copy the site key and secret key.
5. **Anthropic:**
   - Create an API key.
   - Choose the model: the current top-tier Claude model from Anthropic's models page. Set it as `ANTHROPIC_MODEL`.
   - Ask Anthropic about zero data retention for your account (SPEC.md §7.3).
6. Generate two random secrets: `openssl rand -hex 32` for `APP_SECRET`, and again for `CRON_SECRET`.

### 3. Set up the database

From a computer with this repo and Node 22:

```bash
npm install
DATABASE_URL='postgres://…' npm run migrate -w apps/web
```

Run it again after any update that adds a file to `apps/web/migrations/`. It's safe to re-run.

### 4. Store secrets in Google Secret Manager

```bash
gcloud config set project YOUR_PROJECT_ID
for name in app-secret cron-secret database-url anthropic-api-key google-maps-api-key resend-api-key turnstile-secret-key; do
  gcloud secrets create "$name" --replication-policy=automatic
done
printf '%s' 'THE_VALUE' | gcloud secrets versions add app-secret --data-file=-
# …repeat for each secret
```

Grant the Cloud Run service account (by default `PROJECT_NUMBER-compute@developer.gserviceaccount.com`) the
**Secret Manager Secret Accessor** role.

### 5. Deploy

From the repo root (Cloud Build uses the `Dockerfile`):

```bash
gcloud run deploy clinic-web --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars "SITE_URL=https://yourbrand.com,MAILING_ADDRESS=123 Main St, City, ST 00000,EMAIL_FROM=Your Brand <hello@yourbrand.com>,ANTHROPIC_MODEL=THE_MODEL_ID,TURNSTILE_SITE_KEY=YOUR_SITE_KEY" \
  --set-secrets "APP_SECRET=app-secret:latest,CRON_SECRET=cron-secret:latest,DATABASE_URL=database-url:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,GOOGLE_MAPS_API_KEY=google-maps-api-key:latest,RESEND_API_KEY=resend-api-key:latest,TURNSTILE_SECRET_KEY=turnstile-secret-key:latest"
```

Check it's up: open `https://<your-cloud-run-url>/api/health`, which should show `{"ok":true,…}`.

Then map your domain under Cloud Run → Manage custom domains, or put it behind Cloudflare.

### 6. Schedule the nurture emails

```bash
gcloud scheduler jobs create http nurture-emails --location us-central1 \
  --schedule "0 * * * *" --http-method POST \
  --uri "https://yourbrand.com/api/cron/nurture" \
  --headers "Authorization=Bearer YOUR_CRON_SECRET"
```

### 7. Go-live checklist

- [ ] A healthcare attorney has reviewed the privacy and terms pages and the questions in SPEC.md §9.8
- [ ] Privacy page has your contact details; terms page has a date
- [ ] `MAILING_ADDRESS` is set, and a test email shows it in the footer
- [ ] Google key is restricted to the two APIs, with a budget alert and daily quotas set
- [ ] Turnstile keys are set; the tools show the human check
- [ ] Test the Reply Checker: an unsafe reply is flagged; entering an email unlocks rewrites
- [ ] Test the Visibility Score on your own clinic; check that the competitor list looks right
- [ ] Sign up with marketing consent → confirmation email arrives → confirm → unsubscribe link works
- [ ] Brand name set in `apps/web/src/lib/brand.ts` (currently the working name)

### Updating

Push to `main` and re-run the deploy command (or connect Cloud Run to the GitHub repo for automatic deploys). Playbook
edits ship the same way: they're part of the image.

## Phase 2: Secret Shopper

The Secret Shopper runs on the same deployment. Sales stay closed in production until you set `SHOPPER_OPEN=true`, so you
can deploy all of this, then run a full test against the built-in test clinic before anyone can pay.

### Accounts and costs

| Service | What it's for | Cost at launch |
|---|---|---|
| **Stripe** | Checkout, Monthly Retest subscriptions, refunds, the customer billing portal | 2.9% + 30¢ per charge |
| **Twilio** | Local phone numbers for personas: voicemail, transcripts, texts (receive-only) | ~$1.15/number/month + usage |
| **2–3 persona email domains** | Personal-style domains for persona mailboxes (never look-alikes of Gmail or other providers) | ~$10–15/year each |
| **Cloudflare** | DNS and Email Routing for the persona domains, plus the inbound email worker | Free |
| **A hosted browser** (optional) | Submitting web forms automatically (any service with a Chrome DevTools websocket) | From ~$0 to $50/month; without it, a VA submits forms |

### 1. Database

Run the migrations again: Phase 2 adds `002_shopper.sql`.

```bash
DATABASE_URL='postgres://…' npm run migrate -w apps/web
```

### 2. Stripe

1. Create the account and finish business verification. Decide on sales tax with your accountant (Stripe Tax is an option).
2. Copy the secret key into Secret Manager as `stripe-secret-key`.
3. Developers → Webhooks → add an endpoint: `https://yourbrand.com/api/stripe/webhook`, with these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   Save its signing secret as `stripe-webhook-secret`.
4. Settings → Billing → Customer portal: turn on invoice history, payment method updates, and cancellation.

Prices are in `apps/web/src/lib/shopper/purchase.ts` (`PRICES`): $199 baseline, $99/month retests.

### 3. Persona email

For each persona domain:

1. Add it to Cloudflare and turn on **Email Routing**.
2. Verify it in **Resend** for sending (publish the SPF and DKIM records) and turn **off** open and click tracking.
3. Deploy the worker in [`workers/inbound-email`](../workers/inbound-email/README.md), then set each domain's
   catch-all route to it.

Set `PERSONA_EMAIL_DOMAINS=domain-one.com,domain-two.com` and a random `INBOUND_EMAIL_SECRET`, shared with the worker.

### 4. Twilio

1. Buy local numbers in the area codes you expect to test (start with 6; each test uses up to 3, and numbers rest 30
   days between tests).
2. For each number, set:
   - **A call comes in:** POST `https://yourbrand.com/api/twilio/voice`
   - **Call status changes:** POST `https://yourbrand.com/api/twilio/status`
   - **A message comes in:** POST `https://yourbrand.com/api/twilio/sms`
3. Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (Secret Manager: `twilio-auth-token`).
4. After deploying, add the numbers in the console under **Numbers**.

Personas never call or text out in v1, so carrier registration for outbound texting (A2P 10DLC) isn't needed yet.

### 5. Forms

Set `BROWSER_WS_ENDPOINT` to your hosted browser's websocket URL. Without it, every web-form inquiry becomes a VA task
due within two hours of its scheduled time. The Cloud Run image doesn't include a browser.

### 6. Staff

Set `ADMIN_EMAILS` (you) and `VA_EMAILS`. Staff sign in at `/admin` with a one-time email link. **Turn on two-factor
authentication for every staff mailbox**, since the mailbox is the key to the console. For more protection, put
`/admin` behind Identity-Aware Proxy. `OPS_ALERT_EMAIL` gets an email for each new VA task (default: the first admin).

### 7. Deploy and schedule

Add the new settings to the deploy command's `--set-env-vars` and `--set-secrets`. Then schedule the Secret Shopper
engine every 5 minutes:

```bash
gcloud scheduler jobs create http shopper-engine --location us-central1 \
  --schedule "*/5 * * * *" --http-method POST \
  --uri "https://yourbrand.com/api/cron/shopper" \
  --headers "Authorization=Bearer YOUR_CRON_SECRET" \
  --attempt-deadline 300s
```

### 8. Dry run on the test clinic

`https://yourbrand.com/test-clinic` is a fictional clinic you control. Set `TEST_CLINIC_EMAIL` to an inbox you read, so
its contact form forwards inquiries there the way a real clinic's site would. Optionally set `TEST_CLINIC_PHONE`.

1. Sign in to the console (staff can order while sales are closed), then go to `/secret-shopper/start`.
2. Order a test for it:
   - **Website:** `https://yourbrand.com/test-clinic`
   - **Contact form page:** `https://yourbrand.com/test-clinic/contact`
   - **Public email:** your `TEST_CLINIC_EMAIL`
   - **Payment:** your own card; refund yourself afterward.
3. Verify ownership from the console (Queue → Verify ownership).
4. Over the next days, act as the front desk. Reply to persona emails from the test inbox, call and text the persona
   numbers, and leave voicemails. Approve the persona replies in the console.
5. When the report reaches QA, read it end to end, approve it, and check the email and PDF.

### 9. Phase 2 go-live checklist

- [ ] An attorney has reviewed the Secret Shopper terms, recording voicemails, and AI-drafted persona messages
      (state bot-disclosure laws; SPEC.md §9.2, §9.8)
- [ ] The dry run above produced a report you'd be happy to send
- [ ] Stripe webhooks show successful deliveries; a refund from the console reaches Stripe
- [ ] A persona email to a real inbox arrives as plain text with no tracking, and a reply lands on the test's timeline
- [ ] A call to a persona number plays the greeting, and the voicemail and transcript appear
- [ ] Staff mailboxes have two-factor authentication on
- [ ] The engine job runs every 5 minutes (Cloud Scheduler shows successes)
- [ ] `SHOPPER_OPEN=true`
