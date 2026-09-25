-- Phase 1 schema. Apply with: npm run migrate -w apps/web
-- Privacy rules (SPEC.md §7.3, §10.7):
--   * reply_checks never stores the pasted text, only the verdict and flag categories.
--   * visibility_scans stores our computed scores, never Google's ratings or reviews.

-- gen_random_uuid() is built into Postgres 13+; no extension needed.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  sources TEXT[] NOT NULL DEFAULT '{}',
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  nurture_step INTEGER NOT NULL DEFAULT 0,
  nurture_next_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_nurture_due ON leads (nurture_next_at)
  WHERE marketing_consent AND confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;

CREATE TABLE IF NOT EXISTS reply_checks (
  id BIGSERIAL PRIMARY KEY,
  verdict TEXT NOT NULL,
  categories TEXT[] NOT NULL DEFAULT '{}',
  clinic_type TEXT,
  mode TEXT NOT NULL,
  lead_id UUID REFERENCES leads (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visibility_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id TEXT NOT NULL,
  clinic_type TEXT NOT NULL,
  clinic_name TEXT NOT NULL,
  total INTEGER NOT NULL,
  pillars JSONB NOT NULL,
  quick_wins TEXT[] NOT NULL DEFAULT '{}',
  playbook_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_counters (
  key TEXT NOT NULL,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, day)
);
