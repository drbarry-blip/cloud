# Clinic Growth Suite (working name)

Self-serve patient-acquisition tools for independent US clinics: med spas, hormone and weight-loss clinics, dental
practices, and chiropractic / PT / wellness clinics. The full plan is in [`SPEC.md`](SPEC.md).

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Spec and playbook | Drafted; owner decisions applied (playbook v0.2.0-draft) |
| 1 | Website, Review Reply Checker, Visibility Score, safe-reply library, email capture | **Built.** Needs accounts and keys to go live (see [deployment guide](docs/DEPLOY.md)) |
| 2 | Speed-to-Lead Secret Shopper: setup and checkout, verification, scheduling, sending, capture, persona replies, grading, QA, reports, console, customer account, Monthly Retests | **Built.** Sales stay closed until `SHOPPER_OPEN=true`; run the test-clinic dry run first ([deployment guide](docs/DEPLOY.md#phase-2-secret-shopper)) |

## What's here

```
SPEC.md                  product and technical spec
playbook/                the owner's know-how as data (rules, scripts, scoring) — see playbook/README.md
packages/core/           pure logic: playbook loader, reply-checker rules, visibility scoring, website
                         detection, and the Secret Shopper's scheduling, personas, and grading
apps/web/                Next.js app: pages, API routes, email, database, the Secret Shopper engine
  migrations/            SQL, applied in order (Postgres in production, PGlite locally)
  src/lib/shopper/       purchase, scheduling, sending, capture, grading, reports, retests, console actions
workers/inbound-email/   Cloudflare Email Worker that forwards persona mail to the app
docs/DEPLOY.md           step-by-step deployment to Google Cloud Run
```

## Run it locally

Requires Node 22.

```bash
npm install
npm run dev          # http://localhost:3000
```

It works with no configuration. The Reply Checker runs rules-only, emails print to the terminal, the database is an
embedded Postgres (PGlite) kept in memory (set `PGLITE_DIR` to keep it), checkout is simulated, and web forms go to
the VA queue. To switch on AI, Google data, email, Stripe, Twilio, or a real database, copy `.env.example` to
`apps/web/.env.local` and fill in the keys you have.

To try the Secret Shopper locally:

- **As a buyer:** open `/secret-shopper`, start a test, and pay on the simulated checkout. Sign-in and confirmation
  links print to the terminal.
- **As staff:** set `ADMIN_EMAILS=you@example.com`, then sign in at `/admin` with the link from the terminal.
- **With data:** `curl -X POST localhost:3000/api/dev/seed-demo` runs a complete fictional test (sends, calls,
  voicemails, emails, texts, persona replies, grading) so the console and report have something in them.
- **The public sample report** at `/secret-shopper/sample-report` is produced the same way.

## Checks

```bash
npm test             # 200+ tests, including the real playbook, real SQL on PGlite, and a real browser for forms
npm run typecheck
npm run build
```

CI runs all three plus a Docker build on every pull request.

## Privacy by design

- The Reply Checker never stores or logs pasted text, and its page loads no analytics.
- The Visibility Score stores Google place IDs and our computed scores, never Google's ratings or reviews.
- Marketing email starts only after double opt-in; every email has one-click unsubscribe and a postal address.
- Secret Shopper personas are fictional. Messages that look like real patient information are withheld from
  everyone but admins and deleted within 7 days. Evidence is kept 24 months, voicemail audio 12 months.
- No clinic is tested until the buyer is verified, and inquiries may only go to the clinic's own site and email.

See SPEC.md §9 for the compliance posture and the open questions for an attorney.
