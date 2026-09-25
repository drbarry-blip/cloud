# Deploying Phase 1

This guide takes the app from this repo to a live site on Google Cloud Run. Plan on 2–3 hours the first time. A
contractor can do it, but you'll need to create the accounts yourself, since they hold your billing and business details.

## 1. Accounts to create (you)

| Service | What it's for | Cost at launch |
|---|---|---|
| **Google Cloud** (with a billing account) | Hosting (Cloud Run), Places API, PageSpeed | Free tiers cover early use; set a budget alert |
| **Neon** (or Cloud SQL) | Postgres database | Free tier to start |
| **Resend** | Sending email | Free tier to start |
| **Cloudflare** | Turnstile bot protection (free) | Free |
| **Anthropic** | Claude API for the Reply Checker's AI review | Pay per use (cents per check) |
| A domain name | Your site address, e.g. `yourbrand.com` | ~$15/year |

## 2. Get the keys

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

## 3. Set up the database

From a computer with this repo and Node 22:

```bash
npm install
DATABASE_URL='postgres://…' npm run migrate -w apps/web
```

Run it again after any update that adds a file to `apps/web/migrations/`. It's safe to re-run.

## 4. Store secrets in Google Secret Manager

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

## 5. Deploy

From the repo root (Cloud Build uses the `Dockerfile`):

```bash
gcloud run deploy clinic-web --source . --region us-central1 --allow-unauthenticated \
  --set-env-vars "SITE_URL=https://yourbrand.com,MAILING_ADDRESS=123 Main St, City, ST 00000,EMAIL_FROM=Your Brand <hello@yourbrand.com>,ANTHROPIC_MODEL=THE_MODEL_ID,TURNSTILE_SITE_KEY=YOUR_SITE_KEY" \
  --set-secrets "APP_SECRET=app-secret:latest,CRON_SECRET=cron-secret:latest,DATABASE_URL=database-url:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,GOOGLE_MAPS_API_KEY=google-maps-api-key:latest,RESEND_API_KEY=resend-api-key:latest,TURNSTILE_SECRET_KEY=turnstile-secret-key:latest"
```

Check it's up: open `https://<your-cloud-run-url>/api/health`, which should show `{"ok":true,…}`.

Then map your domain under Cloud Run → Manage custom domains, or put it behind Cloudflare.

## 6. Schedule the nurture emails

```bash
gcloud scheduler jobs create http nurture-emails --location us-central1 \
  --schedule "0 * * * *" --http-method POST \
  --uri "https://yourbrand.com/api/cron/nurture" \
  --headers "Authorization=Bearer YOUR_CRON_SECRET"
```

## 7. Go-live checklist

- [ ] A healthcare attorney has reviewed the privacy and terms pages and the questions in SPEC.md §9.8
- [ ] Privacy page has your contact details; terms page has a date
- [ ] `MAILING_ADDRESS` is set, and a test email shows it in the footer
- [ ] Google key is restricted to the two APIs, with a budget alert and daily quotas set
- [ ] Turnstile keys are set; the tools show the human check
- [ ] Test the Reply Checker: an unsafe reply is flagged; entering an email unlocks rewrites
- [ ] Test the Visibility Score on your own clinic; check that the competitor list looks right
- [ ] Sign up with marketing consent → confirmation email arrives → confirm → unsubscribe link works
- [ ] Brand name set in `apps/web/src/lib/brand.ts` (currently the working name)

## Updating

Push to `main` and re-run the deploy command (or connect Cloud Run to the GitHub repo for automatic deploys). Playbook
edits ship the same way: they're part of the image.
