-- Phase 2: Speed-to-Lead Secret Shopper.
-- Everything here is about clinics (businesses) and fictional personas; no real
-- patient data is stored (SPEC.md §9.1). Customers are identified by their lead row.

CREATE TABLE IF NOT EXISTS clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_lead_id UUID NOT NULL REFERENCES leads (id),
  place_id TEXT,
  name TEXT NOT NULL,
  address TEXT,
  website TEXT,
  phone TEXT,
  public_email TEXT,
  form_urls TEXT[] NOT NULL DEFAULT '{}',
  clinic_type TEXT NOT NULL,
  services TEXT[] NOT NULL,
  timezone TEXT NOT NULL,
  hours JSONB NOT NULL,
  blackout_dates TEXT[] NOT NULL DEFAULT '{}',
  owner_standard TEXT,
  callback_number TEXT,
  booking_link TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | rejected
  verification_method TEXT,                             -- email_domain | clinic_code | manual
  verification_code_hash TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinics_owner ON clinics (owner_lead_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics (id),
  lead_id UUID NOT NULL REFERENCES leads (id),
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,                                 -- active | past_due | canceled
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics (id),
  lead_id UUID NOT NULL REFERENCES leads (id),
  product TEXT NOT NULL,                                -- baseline | retest
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',               -- pending | paid | refunded | cancelled
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  stripe_invoice_id TEXT UNIQUE,
  subscription_id UUID REFERENCES subscriptions (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS shopper_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics (id),
  order_id UUID REFERENCES orders (id),
  kind TEXT NOT NULL,                                   -- baseline | retest
  -- awaiting_payment | awaiting_verification | scheduled | running | grading | qa | delivered | cancelled | failed
  status TEXT NOT NULL,
  seed INTEGER NOT NULL,
  playbook_version TEXT NOT NULL,
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  result JSONB,
  headline_override TEXT,
  qa_notes TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shopper_tests_status ON shopper_tests (status);
-- One active test per clinic location (SPEC.md §7.1).
CREATE UNIQUE INDEX IF NOT EXISTS shopper_tests_one_active ON shopper_tests (clinic_id)
  WHERE status IN ('awaiting_verification', 'scheduled', 'running', 'grading', 'qa');

CREATE TABLE IF NOT EXISTS persona_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID NOT NULL REFERENCES shopper_tests (id) ON DELETE CASCADE,
  script TEXT NOT NULL,                                 -- silent | engaged | price_check
  channel TEXT NOT NULL,                                -- web_form | email
  service_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  sex TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  target TEXT,                                          -- form URL or clinic email address
  scheduled_at TIMESTAMPTZ NOT NULL,
  send_status TEXT NOT NULL DEFAULT 'scheduled',        -- scheduled | sending | sent | needs_va | failed | cancelled
  sent_at TIMESTAMPTZ,
  observe_until TIMESTAMPTZ,
  late_until TIMESTAMPTZ,
  follow_up_sent_at TIMESTAMPTZ,
  replies_sent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS persona_assignments_test ON persona_assignments (test_id);
CREATE INDEX IF NOT EXISTS persona_assignments_due ON persona_assignments (scheduled_at) WHERE send_status = 'scheduled';

CREATE TABLE IF NOT EXISTS outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES persona_assignments (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                                   -- inquiry | follow_up
  channel TEXT NOT NULL,                                -- web_form | email
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  sent_by TEXT NOT NULL,                                -- bot | va
  evidence JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS inbound_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID REFERENCES persona_assignments (id) ON DELETE SET NULL,
  channel TEXT NOT NULL,                                -- email | sms | call
  from_addr TEXT,
  to_addr TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  subject TEXT,
  body TEXT,                                            -- email text, SMS text, or voicemail transcript
  headers JSONB NOT NULL DEFAULT '{}',
  voicemail BOOLEAN NOT NULL DEFAULT false,
  recording_url TEXT,
  call_sid TEXT UNIQUE,
  duration_seconds INTEGER,
  label TEXT,                                           -- personal | auto_reply | marketing | reminder
  late BOOLEAN NOT NULL DEFAULT false,
  phi_quarantined BOOLEAN NOT NULL DEFAULT false,       -- PHI tripwire (SPEC.md §9.1)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbound_events_assignment ON inbound_events (assignment_id);

CREATE TABLE IF NOT EXISTS ops_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- verify_ownership | submit_form | approve_reply | match_inbound | qa_report
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',                  -- open | done | cancelled
  test_id UUID REFERENCES shopper_tests (id) ON DELETE CASCADE,
  assignment_id UUID REFERENCES persona_assignments (id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES clinics (id) ON DELETE CASCADE,
  inbound_event_id UUID REFERENCES inbound_events (id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  due_at TIMESTAMPTZ,
  completed_by TEXT,
  minutes_spent INTEGER,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ops_tasks_open ON ops_tasks (due_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS phone_numbers (
  e164 TEXT PRIMARY KEY,
  area_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',             -- available | assigned | retired
  assignment_id UUID REFERENCES persona_assignments (id) ON DELETE SET NULL,
  available_after TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
