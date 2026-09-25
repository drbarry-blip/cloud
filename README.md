# Clinic Growth Suite (working name)

Self-serve patient-acquisition tools for independent US clinics: med spas, hormone and weight-loss clinics, dental
practices, and chiropractic / PT / wellness clinics. The full plan is in [`SPEC.md`](SPEC.md).

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Spec and playbook | Drafted; owner decisions applied (playbook v0.2.0-draft) |
| 1 | Website, Review Reply Checker, Visibility Score, safe-reply library, email capture | **Built.** Needs accounts and keys to go live (see [deployment guide](docs/DEPLOY.md)) |
| 2 | Speed-to-Lead Secret Shopper | Not started |

## What's here

```
SPEC.md          product and technical spec
playbook/        the owner's know-how as data (rules, scripts, scoring) — see playbook/README.md
packages/core/   pure logic: playbook loader, reply-checker rules, visibility scoring, website detection
apps/web/        Next.js app: pages, API routes, email, storage
docs/DEPLOY.md   step-by-step deployment to Google Cloud Run
```

## Run it locally

Requires Node 22.

```bash
npm install
npm run dev          # http://localhost:3000
```

It works with no configuration. The Reply Checker runs rules-only, emails print to the terminal, and data stays in
memory. To switch on AI review, Google data, email, or a database, copy `.env.example` to `apps/web/.env.local` and
fill in the keys you have.

## Checks

```bash
npm test             # 100+ unit tests, including validation of the real playbook
npm run typecheck
npm run build
```

CI runs all three plus a Docker build on every pull request.

## Privacy by design

- The Reply Checker never stores or logs pasted text, and its page loads no analytics.
- The Visibility Score stores Google place IDs and our computed scores, never Google's ratings or reviews.
- Marketing email starts only after double opt-in; every email has one-click unsubscribe and a postal address.

See SPEC.md §9 for the compliance posture and the open questions for an attorney.
