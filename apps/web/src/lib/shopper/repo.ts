import type { ScriptId, TouchLabel, WeeklyHours } from "@cgs/core";
import type { Db } from "../db";

// Data access for the Secret Shopper (tables in migrations/002_shopper.sql).
// Every function takes plain values and returns camelCase records. Status changes
// are compare-and-set, so a retried webhook or an overlapping cron tick is harmless.

export type TestStatus =
  | "awaiting_payment"
  | "awaiting_verification"
  | "scheduled"
  | "running"
  | "grading"
  | "qa"
  | "delivered"
  | "cancelled"
  | "failed";
/** Statuses that count as the location's one active test (see the unique index). */
export const ACTIVE_TEST_STATUSES: readonly TestStatus[] = ["awaiting_verification", "scheduled", "running", "grading", "qa"];
export type TestKind = "baseline" | "retest" | "quarterly";
export type InquiryChannel = "web_form" | "email";
export type SendStatus = "scheduled" | "sending" | "sent" | "needs_va" | "failed" | "cancelled";
export type TaskType = "verify_ownership" | "submit_form" | "approve_reply" | "match_inbound" | "review_phi" | "qa_report" | "fix_failure";
export type Product = "baseline" | "retest_monthly";

export interface Clinic {
  id: string;
  ownerLeadId: string;
  placeId: string | null;
  name: string;
  address: string | null;
  website: string | null;
  websiteHost: string | null;
  phone: string | null;
  publicEmail: string | null;
  formUrls: string[];
  clinicType: string;
  services: string[];
  timezone: string;
  hours: WeeklyHours;
  blackoutDates: string[];
  ownerStandard: string | null;
  bookingLink: string | null;
  verificationStatus: "pending" | "verified" | "rejected";
  verificationMethod: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

export type NewClinic = Omit<Clinic, "id" | "verificationStatus" | "verificationMethod" | "verifiedAt" | "createdAt">;

export interface Order {
  id: string;
  clinicId: string;
  leadId: string;
  product: Product;
  amountCents: number;
  status: "pending" | "paid" | "refunded" | "cancelled";
  stripeSessionId: string | null;
  stripePaymentIntent: string | null;
  stripeCustomerId: string | null;
  stripeInvoiceId: string | null;
  subscriptionId: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface Subscription {
  id: string;
  clinicId: string;
  leadId: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd: Date | null;
  createdAt: Date;
}

/** Something ops found during a test that belongs in the report (e.g., a broken form). */
export interface Finding {
  kind: "form_broken" | "email_bounced" | "suspected_detection" | "no_contact_route" | "note";
  text: string;
  at: string;
  assignmentId?: string;
}

export interface ShopperTest {
  id: string;
  clinicId: string;
  orderId: string | null;
  subscriptionId: string | null;
  kind: TestKind;
  status: TestStatus;
  scripts: ScriptId[];
  seed: number;
  playbookVersion: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  findings: Finding[];
  result: unknown;
  score: number | null;
  grade: string | null;
  statusNote: string | null;
  headlineOverride: string | null;
  qaNotes: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Assignment {
  id: string;
  testId: string;
  script: ScriptId;
  channel: InquiryChannel;
  serviceId: string;
  serviceName: string;
  sensitive: boolean;
  firstName: string;
  lastName: string;
  sex: "male" | "female";
  email: string;
  phoneNumber: string | null;
  subject: string;
  message: string;
  target: string | null;
  scheduledAt: Date;
  sendStatus: SendStatus;
  sentAt: Date | null;
  observeUntil: Date | null;
  lateUntil: Date | null;
  followUpSentAt: Date | null;
  repliesSent: number;
  emailMessageId: string | null;
  lastInboundMessageId: string | null;
  createdAt: Date;
}

export type NewAssignment = Pick<
  Assignment,
  | "testId"
  | "script"
  | "channel"
  | "serviceId"
  | "serviceName"
  | "sensitive"
  | "firstName"
  | "lastName"
  | "sex"
  | "email"
  | "phoneNumber"
  | "subject"
  | "message"
  | "target"
  | "scheduledAt"
>;

export interface OutboundMessage {
  id: string;
  assignmentId: string;
  kind: "inquiry" | "follow_up";
  channel: InquiryChannel;
  subject: string | null;
  body: string;
  target: string | null;
  messageId: string | null;
  sentAt: Date;
  sentBy: string;
  evidence: Record<string, unknown>;
}

export interface InboundEvent {
  id: string;
  assignmentId: string | null;
  channel: "email" | "sms" | "call";
  fromAddr: string | null;
  toAddr: string | null;
  receivedAt: Date;
  subject: string | null;
  body: string | null;
  headers: Record<string, string>;
  voicemail: boolean;
  recordingUrl: string | null;
  externalId: string | null;
  durationSeconds: number | null;
  label: TouchLabel | null;
  labelSource: "rules" | "ai" | "va" | null;
  late: boolean;
  phiQuarantined: boolean;
  createdAt: Date;
}

export type NewInboundEvent = Partial<Omit<InboundEvent, "id" | "createdAt" | "channel" | "receivedAt">> &
  Pick<InboundEvent, "channel" | "receivedAt">;

export interface OpsTask {
  id: string;
  type: TaskType;
  status: "open" | "done" | "cancelled";
  title: string;
  testId: string | null;
  assignmentId: string | null;
  clinicId: string | null;
  inboundEventId: string | null;
  payload: Record<string, unknown>;
  dueAt: Date | null;
  assignee: string | null;
  completedBy: string | null;
  minutesSpent: number | null;
  resolution: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface PhoneNumber {
  e164: string;
  areaCode: string;
  status: "available" | "assigned" | "quarantined" | "retired";
  assignmentId: string | null;
  availableAfter: Date | null;
  createdAt: Date;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  details: Record<string, unknown>;
  at: Date;
}

type Row = Record<string, unknown>;

const camel = <T>(row: Row): T =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as T;

function toClinic(row: Row): Clinic {
  const { verificationCodeHash: _hidden, ...clinic } = camel<Clinic & { verificationCodeHash?: string }>(row);
  return clinic;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === "23505";

/** US area code of an E.164 number (+1NXXNXXXXXX). */
export const areaCodeOf = (e164: string) => (/^\+1(\d{3})\d{7}$/.exec(e164)?.[1] ?? "");

export class ShopperRepo {
  constructor(readonly db: Db) {}

  /** Runs `fn` with a repository bound to one transaction. */
  transaction<T>(fn: (repo: ShopperRepo) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new ShopperRepo(tx)));
  }

  private async one<T>(sql: string, params: unknown[], map: (r: Row) => T = camel): Promise<T | null> {
    const { rows } = await this.db.query<Row>(sql, params);
    return rows[0] ? map(rows[0]) : null;
  }

  private async many<T>(sql: string, params: unknown[], map: (r: Row) => T = camel): Promise<T[]> {
    const { rows } = await this.db.query<Row>(sql, params);
    return rows.map(map);
  }

  // ---------- Clinics ----------

  async createClinic(c: NewClinic): Promise<Clinic> {
    return (await this.one(
      `INSERT INTO clinics (owner_lead_id, place_id, name, address, website, website_host, phone, public_email, form_urls,
         clinic_type, services, timezone, hours, blackout_dates, owner_standard, booking_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
      [
        c.ownerLeadId,
        c.placeId,
        c.name,
        c.address,
        c.website,
        c.websiteHost,
        c.phone,
        c.publicEmail,
        c.formUrls,
        c.clinicType,
        c.services,
        c.timezone,
        JSON.stringify(c.hours),
        c.blackoutDates,
        c.ownerStandard,
        c.bookingLink,
      ],
      toClinic,
    ))!;
  }

  getClinic(id: string) {
    return this.one("SELECT * FROM clinics WHERE id = $1", [id], toClinic);
  }

  /** This owner's existing record for the same location, if any. */
  findOwnClinic(ownerLeadId: string, loc: { placeId: string | null; websiteHost: string | null }) {
    return this.one(
      `SELECT * FROM clinics
       WHERE owner_lead_id = $1 AND verification_status <> 'rejected'
         AND ((place_id IS NOT NULL AND place_id = $2) OR (website_host IS NOT NULL AND website_host = $3))
       ORDER BY (verification_status = 'verified') DESC, created_at DESC LIMIT 1`,
      [ownerLeadId, loc.placeId, loc.websiteHost],
      toClinic,
    );
  }

  /** Replaces a clinic's details (not its owner or verification) with what the owner just confirmed. */
  updateClinicDetails(id: string, c: NewClinic) {
    return this.one(
      `UPDATE clinics SET place_id = COALESCE($2, place_id), name = $3, address = $4, website = $5, website_host = $6, phone = $7,
         public_email = $8, form_urls = $9, clinic_type = $10, services = $11, timezone = $12, hours = $13, blackout_dates = $14,
         owner_standard = $15, booking_link = $16
       WHERE id = $1 RETURNING *`,
      [
        id,
        c.placeId,
        c.name,
        c.address,
        c.website,
        c.websiteHost,
        c.phone,
        c.publicEmail,
        c.formUrls,
        c.clinicType,
        c.services,
        c.timezone,
        JSON.stringify(c.hours),
        c.blackoutDates,
        c.ownerStandard,
        c.bookingLink,
      ],
      toClinic,
    );
  }

  clinicsForLead(leadId: string) {
    return this.many("SELECT * FROM clinics WHERE owner_lead_id = $1 ORDER BY created_at DESC", [leadId], toClinic);
  }

  /** Other accounts that have set up the same location (same Google place or website). */
  otherOwnersOfLocation(loc: { placeId: string | null; websiteHost: string | null }, ownerLeadId: string) {
    return this.many<{ clinicId: string; ownerLeadId: string }>(
      `SELECT id AS clinic_id, owner_lead_id FROM clinics
       WHERE owner_lead_id <> $3 AND ((place_id IS NOT NULL AND place_id = $1) OR (website_host IS NOT NULL AND website_host = $2))`,
      [loc.placeId, loc.websiteHost, ownerLeadId],
    );
  }

  /** The active test at this location under any account, if there is one. */
  activeTestAtLocation(loc: { placeId: string | null; websiteHost: string | null }) {
    return this.one<ShopperTest>(
      `SELECT t.* FROM shopper_tests t JOIN clinics c ON c.id = t.clinic_id
       WHERE t.status = ANY($3::text[])
         AND ((c.place_id IS NOT NULL AND c.place_id = $1) OR (c.website_host IS NOT NULL AND c.website_host = $2))
       LIMIT 1`,
      [loc.placeId, loc.websiteHost, ACTIVE_TEST_STATUSES],
    );
  }

  async setVerification(clinicId: string, status: Clinic["verificationStatus"], method: string | null, at: Date) {
    return this.one(
      `UPDATE clinics SET verification_status = $2, verification_method = $3,
         verified_at = CASE WHEN $2 = 'verified' THEN $4::timestamptz ELSE verified_at END,
         verification_code_hash = CASE WHEN $2 = 'verified' THEN NULL ELSE verification_code_hash END
       WHERE id = $1 RETURNING *`,
      [clinicId, status, method, at],
      toClinic,
    );
  }

  async setVerificationCodeHash(clinicId: string, hash: string | null) {
    await this.db.query("UPDATE clinics SET verification_code_hash = $2 WHERE id = $1", [clinicId, hash]);
  }

  async verificationCodeHash(clinicId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ h: string | null }>("SELECT verification_code_hash AS h FROM clinics WHERE id = $1", [clinicId]);
    return rows[0]?.h ?? null;
  }

  // ---------- Orders and subscriptions ----------

  async createOrder(o: { clinicId: string; leadId: string; product: Product; amountCents: number; subscriptionId?: string | null }): Promise<Order> {
    return (await this.one<Order>(
      "INSERT INTO orders (clinic_id, lead_id, product, amount_cents, subscription_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [o.clinicId, o.leadId, o.product, o.amountCents, o.subscriptionId ?? null],
    ))!;
  }

  getOrder(id: string) {
    return this.one<Order>("SELECT * FROM orders WHERE id = $1", [id]);
  }

  async setOrderStripeSession(id: string, sessionId: string) {
    await this.db.query("UPDATE orders SET stripe_session_id = $2 WHERE id = $1", [id, sessionId]);
  }

  /** Marks a pending order paid. Returns null if it was already paid (a retried webhook). */
  markOrderPaid(id: string, p: { paidAt: Date; paymentIntent?: string | null; invoiceId?: string | null; customerId?: string | null }) {
    return this.one<Order>(
      `UPDATE orders SET status = 'paid', paid_at = $2, stripe_payment_intent = COALESCE($3, stripe_payment_intent),
         stripe_invoice_id = COALESCE($4, stripe_invoice_id), stripe_customer_id = COALESCE($5, stripe_customer_id)
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, p.paidAt, p.paymentIntent ?? null, p.invoiceId ?? null, p.customerId ?? null],
    );
  }

  ordersForClinic(clinicId: string) {
    return this.many<Order>("SELECT * FROM orders WHERE clinic_id = $1 ORDER BY created_at DESC", [clinicId]);
  }

  setOrderStatus(id: string, status: Order["status"]) {
    return this.one<Order>("UPDATE orders SET status = $2 WHERE id = $1 RETURNING *", [id, status]);
  }

  orderByInvoice(invoiceId: string) {
    return this.one<Order>("SELECT * FROM orders WHERE stripe_invoice_id = $1", [invoiceId]);
  }

  async upsertSubscription(s: Omit<Subscription, "id" | "createdAt">): Promise<Subscription> {
    return (await this.one<Subscription>(
      `INSERT INTO subscriptions (clinic_id, lead_id, stripe_subscription_id, stripe_customer_id, status, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET
         status = EXCLUDED.status,
         current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id)
       RETURNING *`,
      [s.clinicId, s.leadId, s.stripeSubscriptionId, s.stripeCustomerId, s.status, s.currentPeriodEnd],
    ))!;
  }

  subscriptionByStripeId(stripeSubscriptionId: string) {
    return this.one<Subscription>("SELECT * FROM subscriptions WHERE stripe_subscription_id = $1", [stripeSubscriptionId]);
  }

  setSubscriptionStatus(stripeSubscriptionId: string, status: Subscription["status"], currentPeriodEnd: Date | null) {
    return this.one<Subscription>(
      "UPDATE subscriptions SET status = $2, current_period_end = COALESCE($3, current_period_end) WHERE stripe_subscription_id = $1 RETURNING *",
      [stripeSubscriptionId, status, currentPeriodEnd],
    );
  }

  getSubscription(id: string) {
    return this.one<Subscription>("SELECT * FROM subscriptions WHERE id = $1", [id]);
  }

  subscriptionsForClinic(clinicId: string) {
    return this.many<Subscription>("SELECT * FROM subscriptions WHERE clinic_id = $1 ORDER BY created_at DESC", [clinicId]);
  }

  subscriptionsForLead(leadId: string) {
    return this.many<Subscription>("SELECT * FROM subscriptions WHERE lead_id = $1 ORDER BY created_at DESC", [leadId]);
  }

  // ---------- Tests ----------

  /** Creates a test. Returns null if the clinic already has an active test. */
  async createTest(t: {
    clinicId: string;
    orderId?: string | null;
    subscriptionId?: string | null;
    kind: TestKind;
    status: TestStatus;
    scripts: readonly ScriptId[];
    seed: number;
    playbookVersion: string;
  }): Promise<ShopperTest | null> {
    try {
      return await this.one<ShopperTest>(
        `INSERT INTO shopper_tests (clinic_id, order_id, subscription_id, kind, status, scripts, seed, playbook_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [t.clinicId, t.orderId ?? null, t.subscriptionId ?? null, t.kind, t.status, t.scripts, t.seed, t.playbookVersion],
      );
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  getTest(id: string) {
    return this.one<ShopperTest>("SELECT * FROM shopper_tests WHERE id = $1", [id]);
  }

  testForOrder(orderId: string) {
    return this.one<ShopperTest>("SELECT * FROM shopper_tests WHERE order_id = $1", [orderId]);
  }

  testsForClinic(clinicId: string) {
    return this.many<ShopperTest>("SELECT * FROM shopper_tests WHERE clinic_id = $1 ORDER BY created_at DESC", [clinicId]);
  }

  testsForSubscription(subscriptionId: string) {
    return this.many<ShopperTest>("SELECT * FROM shopper_tests WHERE subscription_id = $1 ORDER BY created_at", [subscriptionId]);
  }

  /** Queued retests (paid, waiting for the clinic's current test to finish). */
  queuedRetests() {
    return this.many<ShopperTest>(
      `SELECT t.* FROM shopper_tests t JOIN orders o ON o.id = t.order_id
       WHERE t.status = 'awaiting_payment' AND t.subscription_id IS NOT NULL AND o.status = 'paid' ORDER BY t.created_at`,
      [],
    );
  }

  /** Delivered tests for a clinic, newest first (for trends and score-drop alerts). */
  deliveredTests(clinicId: string) {
    return this.many<ShopperTest>("SELECT * FROM shopper_tests WHERE clinic_id = $1 AND status = 'delivered' ORDER BY delivered_at DESC", [clinicId]);
  }

  testsWithStatus(statuses: readonly TestStatus[], limit = 100) {
    return this.many<ShopperTest>("SELECT * FROM shopper_tests WHERE status = ANY($1::text[]) ORDER BY created_at LIMIT $2", [statuses, limit]);
  }

  /**
   * Moves a test to `to` only if it's currently in one of `from`. Returns the updated
   * test, or null if another process moved it first (or the move would break the
   * one-active-test rule).
   */
  async transitionTest(id: string, from: readonly TestStatus[], to: TestStatus, note?: string | null): Promise<ShopperTest | null> {
    try {
      return await this.one<ShopperTest>(
        `UPDATE shopper_tests SET status = $3, status_note = COALESCE($4, status_note), updated_at = now(),
           delivered_at = CASE WHEN $3 = 'delivered' THEN now() ELSE delivered_at END
         WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`,
        [id, from, to, note ?? null],
      );
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  setTestWindow(id: string, start: Date, end: Date) {
    return this.one<ShopperTest>("UPDATE shopper_tests SET window_start = $2, window_end = $3, updated_at = now() WHERE id = $1 RETURNING *", [
      id,
      start,
      end,
    ]);
  }

  async addFinding(id: string, finding: Finding) {
    await this.db.query("UPDATE shopper_tests SET findings = findings || $2::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify([finding])]);
  }

  async saveResult(id: string, result: unknown, score: number, grade: string) {
    await this.db.query("UPDATE shopper_tests SET result = $2, score = $3, grade = $4, updated_at = now() WHERE id = $1", [
      id,
      JSON.stringify(result),
      Math.round(score),
      grade,
    ]);
  }

  async setQaEdits(id: string, edits: { headlineOverride: string | null; qaNotes: string | null }) {
    await this.db.query("UPDATE shopper_tests SET headline_override = $2, qa_notes = $3, updated_at = now() WHERE id = $1", [
      id,
      edits.headlineOverride,
      edits.qaNotes,
    ]);
  }

  // ---------- Persona assignments ----------

  /** Every persona address ever used (addresses are never reused). */
  async personaEmails(): Promise<Set<string>> {
    const { rows } = await this.db.query<{ email: string }>("SELECT email FROM persona_assignments");
    return new Set(rows.map((r) => r.email));
  }

  async insertAssignment(a: NewAssignment): Promise<Assignment> {
    return (await this.one<Assignment>(
      `INSERT INTO persona_assignments (test_id, script, channel, service_id, service_name, sensitive, first_name, last_name, sex,
         email, phone_number, subject, message, target, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        a.testId,
        a.script,
        a.channel,
        a.serviceId,
        a.serviceName,
        a.sensitive,
        a.firstName,
        a.lastName,
        a.sex,
        a.email,
        a.phoneNumber,
        a.subject,
        a.message,
        a.target,
        a.scheduledAt,
      ],
    ))!;
  }

  getAssignment(id: string) {
    return this.one<Assignment>("SELECT * FROM persona_assignments WHERE id = $1", [id]);
  }

  assignmentsForTest(testId: string) {
    return this.many<Assignment>("SELECT * FROM persona_assignments WHERE test_id = $1 ORDER BY scheduled_at", [testId]);
  }

  /** Inquiries whose send time has come, on tests that are cleared to run. */
  dueAssignments(now: Date, limit = 20) {
    return this.many<Assignment>(
      `SELECT a.* FROM persona_assignments a JOIN shopper_tests t ON t.id = a.test_id
       WHERE a.send_status = 'scheduled' AND a.scheduled_at <= $1 AND t.status IN ('scheduled', 'running')
       ORDER BY a.scheduled_at LIMIT $2`,
      [now, limit],
    );
  }

  /** Claims an inquiry for sending. Only one caller wins. */
  async claimAssignment(id: string, from: readonly SendStatus[] = ["scheduled"]): Promise<boolean> {
    const { rows } = await this.db.query("UPDATE persona_assignments SET send_status = 'sending' WHERE id = $1 AND send_status = ANY($2::text[]) RETURNING id", [
      id,
      from,
    ]);
    return rows.length > 0;
  }

  setSendStatus(id: string, status: SendStatus, from?: readonly SendStatus[]) {
    return from
      ? this.one<Assignment>("UPDATE persona_assignments SET send_status = $2 WHERE id = $1 AND send_status = ANY($3::text[]) RETURNING *", [id, status, from])
      : this.one<Assignment>("UPDATE persona_assignments SET send_status = $2 WHERE id = $1 RETURNING *", [id, status]);
  }

  /** Inquiries stuck in "sending" (a crashed worker), for ops to check by hand. */
  stuckSending(olderThan: Date) {
    return this.many<Assignment>(
      "SELECT * FROM persona_assignments WHERE send_status = 'sending' AND scheduled_at < $1 ORDER BY scheduled_at",
      [olderThan],
    );
  }

  markSent(
    id: string,
    s: { sentAt: Date; observeUntil: Date; lateUntil: Date; channel: InquiryChannel; target: string | null; emailMessageId?: string | null },
  ) {
    return this.one<Assignment>(
      `UPDATE persona_assignments SET send_status = 'sent', sent_at = $2, observe_until = $3, late_until = $4, channel = $5,
         target = $6, email_message_id = COALESCE($7, email_message_id)
       WHERE id = $1 RETURNING *`,
      [id, s.sentAt, s.observeUntil, s.lateUntil, s.channel, s.target, s.emailMessageId ?? null],
    );
  }

  /** Switches an unsent inquiry to another channel (e.g., the form is broken, so use email). */
  switchChannel(id: string, channel: InquiryChannel, target: string | null) {
    return this.one<Assignment>("UPDATE persona_assignments SET channel = $2, target = $3 WHERE id = $1 RETURNING *", [id, channel, target]);
  }

  /** Puts an inquiry back in the send queue at `at` (a retry, or a switch to another channel). */
  rescheduleAssignment(id: string, at: Date) {
    return this.one<Assignment>(
      "UPDATE persona_assignments SET send_status = 'scheduled', scheduled_at = $2 WHERE id = $1 AND send_status IN ('needs_va', 'failed', 'scheduled') RETURNING *",
      [id, at],
    );
  }

  assignmentByEmail(email: string) {
    return this.one<Assignment>("SELECT * FROM persona_assignments WHERE email = $1", [email.trim().toLowerCase()]);
  }

  /**
   * The persona a call or text on this number belongs to: the latest one whose inquiry
   * had gone out (or was due) by then. Numbers are quarantined between tests, so
   * there's no overlap.
   */
  assignmentByPhone(e164: string, at: Date) {
    return this.one<Assignment>(
      `SELECT * FROM persona_assignments WHERE phone_number = $1 AND COALESCE(sent_at, scheduled_at) <= $2
       ORDER BY COALESCE(sent_at, scheduled_at) DESC LIMIT 1`,
      [e164, at],
    );
  }

  /** Records a persona reply. Returns null if the persona has already used its replies. */
  recordPersonaReply(id: string, r: { at: Date; messageId: string | null; maxReplies: number }) {
    return this.one<Assignment>(
      `UPDATE persona_assignments SET replies_sent = replies_sent + 1, follow_up_sent_at = COALESCE(follow_up_sent_at, $2),
         email_message_id = COALESCE($3, email_message_id)
       WHERE id = $1 AND replies_sent < $4 RETURNING *`,
      [id, r.at, r.messageId, r.maxReplies],
    );
  }

  async setLastInboundMessageId(id: string, messageId: string) {
    await this.db.query("UPDATE persona_assignments SET last_inbound_message_id = $2 WHERE id = $1", [id, messageId]);
  }

  async cancelUnsent(testId: string) {
    const { rows } = await this.db.query(
      "UPDATE persona_assignments SET send_status = 'cancelled' WHERE test_id = $1 AND send_status IN ('scheduled', 'needs_va') RETURNING id",
      [testId],
    );
    return rows.length;
  }

  // ---------- Messages ----------

  async insertOutbound(m: Omit<OutboundMessage, "id" | "evidence"> & { evidence?: Record<string, unknown> }): Promise<OutboundMessage> {
    return (await this.one<OutboundMessage>(
      `INSERT INTO outbound_messages (assignment_id, kind, channel, subject, body, target, message_id, sent_at, sent_by, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [m.assignmentId, m.kind, m.channel, m.subject, m.body, m.target, m.messageId, m.sentAt, m.sentBy, JSON.stringify(m.evidence ?? {})],
    ))!;
  }

  outboundForTest(testId: string) {
    return this.many<OutboundMessage>(
      `SELECT o.* FROM outbound_messages o JOIN persona_assignments a ON a.id = o.assignment_id
       WHERE a.test_id = $1 ORDER BY o.sent_at`,
      [testId],
    );
  }

  /**
   * Stores an inbound email, text, or call. Webhooks retry, so an event with an
   * external ID that's already stored is returned as-is with `created: false`.
   */
  async insertInbound(e: NewInboundEvent): Promise<{ event: InboundEvent; created: boolean }> {
    const inserted = await this.one<InboundEvent>(
      `INSERT INTO inbound_events (assignment_id, channel, from_addr, to_addr, received_at, subject, body, headers, voicemail,
         recording_url, external_id, duration_seconds, label, label_source, late, phi_quarantined)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (external_id) DO NOTHING RETURNING *`,
      [
        e.assignmentId ?? null,
        e.channel,
        e.fromAddr ?? null,
        e.toAddr ?? null,
        e.receivedAt,
        e.subject ?? null,
        e.body ?? null,
        JSON.stringify(e.headers ?? {}),
        e.voicemail ?? false,
        e.recordingUrl ?? null,
        e.externalId ?? null,
        e.durationSeconds ?? null,
        e.label ?? null,
        e.labelSource ?? null,
        e.late ?? false,
        e.phiQuarantined ?? false,
      ],
    );
    if (inserted) return { event: inserted, created: true };
    const existing = await this.one<InboundEvent>("SELECT * FROM inbound_events WHERE external_id = $1", [e.externalId]);
    return { event: existing!, created: false };
  }

  /** Fills in later details of a call (its voicemail recording or transcript) as the callbacks arrive. */
  updateCall(externalId: string, patch: { voicemail?: boolean; recordingUrl?: string | null; body?: string | null; durationSeconds?: number | null }) {
    return this.one<InboundEvent>(
      `UPDATE inbound_events SET voicemail = voicemail OR COALESCE($2, false), recording_url = COALESCE($3, recording_url),
         body = COALESCE($4, body), duration_seconds = COALESCE($5, duration_seconds)
       WHERE external_id = $1 RETURNING *`,
      [externalId, patch.voicemail ?? null, patch.recordingUrl ?? null, patch.body ?? null, patch.durationSeconds ?? null],
    );
  }

  inboundByExternalId(externalId: string) {
    return this.one<InboundEvent>("SELECT * FROM inbound_events WHERE external_id = $1", [externalId]);
  }

  getInbound(id: string) {
    return this.one<InboundEvent>("SELECT * FROM inbound_events WHERE id = $1", [id]);
  }

  inboundForTest(testId: string) {
    return this.many<InboundEvent>(
      `SELECT e.* FROM inbound_events e JOIN persona_assignments a ON a.id = e.assignment_id
       WHERE a.test_id = $1 ORDER BY e.received_at`,
      [testId],
    );
  }

  setInboundLabel(id: string, label: TouchLabel, source: "rules" | "ai" | "va") {
    return this.one<InboundEvent>("UPDATE inbound_events SET label = $2, label_source = $3 WHERE id = $1 RETURNING *", [id, label, source]);
  }

  attachInbound(id: string, assignmentId: string, late: boolean) {
    return this.one<InboundEvent>("UPDATE inbound_events SET assignment_id = $2, late = $3 WHERE id = $1 RETURNING *", [id, assignmentId, late]);
  }

  setPhiQuarantine(id: string, quarantined: boolean) {
    return this.one<InboundEvent>("UPDATE inbound_events SET phi_quarantined = $2 WHERE id = $1 RETURNING *", [id, quarantined]);
  }

  /** Deletes one message's content now (confirmed PHI). Keeps the time and channel for the record. */
  async purgeInbound(id: string) {
    await this.db.query("UPDATE inbound_events SET body = NULL, subject = NULL, recording_url = NULL, headers = '{}', phi_quarantined = true WHERE id = $1", [id]);
  }

  /** Deletes the content of quarantined messages flagged before `before` (SPEC.md §9.1: within 7 days). */
  async purgeQuarantined(before: Date): Promise<number> {
    const { rows } = await this.db.query(
      `UPDATE inbound_events SET body = NULL, subject = NULL, recording_url = NULL, headers = '{}'
       WHERE phi_quarantined AND created_at < $1 AND (body IS NOT NULL OR subject IS NOT NULL OR recording_url IS NOT NULL)
       RETURNING id`,
      [before],
    );
    return rows.length;
  }

  // ---------- Ops tasks ----------

  async createTask(t: {
    type: TaskType;
    title: string;
    testId?: string | null;
    assignmentId?: string | null;
    clinicId?: string | null;
    inboundEventId?: string | null;
    payload?: Record<string, unknown>;
    dueAt?: Date | null;
  }): Promise<OpsTask> {
    return (await this.one<OpsTask>(
      `INSERT INTO ops_tasks (type, title, test_id, assignment_id, clinic_id, inbound_event_id, payload, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [t.type, t.title, t.testId ?? null, t.assignmentId ?? null, t.clinicId ?? null, t.inboundEventId ?? null, JSON.stringify(t.payload ?? {}), t.dueAt ?? null],
    ))!;
  }

  getTask(id: string) {
    return this.one<OpsTask>("SELECT * FROM ops_tasks WHERE id = $1", [id]);
  }

  openTasks(limit = 200) {
    return this.many<OpsTask>("SELECT * FROM ops_tasks WHERE status = 'open' ORDER BY due_at NULLS LAST, created_at LIMIT $1", [limit]);
  }

  tasksForTest(testId: string) {
    return this.many<OpsTask>("SELECT * FROM ops_tasks WHERE test_id = $1 ORDER BY created_at", [testId]);
  }

  openTaskFor(type: TaskType, ref: { testId?: string; assignmentId?: string; clinicId?: string; inboundEventId?: string }) {
    const [col, id] = ref.assignmentId
      ? ["assignment_id", ref.assignmentId]
      : ref.inboundEventId
        ? ["inbound_event_id", ref.inboundEventId]
        : ref.testId
          ? ["test_id", ref.testId]
          : ["clinic_id", ref.clinicId];
    return this.one<OpsTask>(`SELECT * FROM ops_tasks WHERE type = $1 AND status = 'open' AND ${col} = $2 LIMIT 1`, [type, id]);
  }

  /** Closes an open task. Returns null if it was already closed. */
  completeTask(id: string, c: { by: string; minutesSpent?: number | null; resolution?: string | null; status?: "done" | "cancelled"; at: Date }) {
    return this.one<OpsTask>(
      `UPDATE ops_tasks SET status = $2, completed_by = $3, minutes_spent = $4, resolution = $5, completed_at = $6
       WHERE id = $1 AND status = 'open' RETURNING *`,
      [id, c.status ?? "done", c.by, c.minutesSpent ?? null, c.resolution ?? null, c.at],
    );
  }

  async cancelOpenTasks(ref: { testId?: string; assignmentId?: string; clinicId?: string; type?: TaskType }, at: Date, reason: string) {
    if (!ref.testId && !ref.assignmentId && !ref.clinicId) throw new Error("cancelOpenTasks needs a test, assignment, or clinic");
    const { rows } = await this.db.query(
      `UPDATE ops_tasks SET status = 'cancelled', completed_by = 'system', resolution = $5, completed_at = $6
       WHERE status = 'open' AND ($1::uuid IS NULL OR test_id = $1) AND ($2::uuid IS NULL OR assignment_id = $2)
         AND ($3::uuid IS NULL OR clinic_id = $3) AND ($4::text IS NULL OR type = $4)
       RETURNING id`,
      [ref.testId ?? null, ref.assignmentId ?? null, ref.clinicId ?? null, ref.type ?? null, reason, at],
    );
    return rows.length;
  }

  // ---------- Phone numbers ----------

  async addNumber(e164: string): Promise<PhoneNumber | null> {
    const areaCode = areaCodeOf(e164);
    if (!areaCode) throw new Error("Use a US number in E.164 format, e.g. +15125550123");
    return this.one<PhoneNumber>("INSERT INTO phone_numbers (e164, area_code) VALUES ($1, $2) ON CONFLICT (e164) DO NOTHING RETURNING *", [e164, areaCode]);
  }

  listNumbers() {
    return this.many<PhoneNumber>("SELECT * FROM phone_numbers ORDER BY area_code, e164", []);
  }

  getNumber(e164: string) {
    return this.one<PhoneNumber>("SELECT * FROM phone_numbers WHERE e164 = $1", [e164]);
  }

  /** Takes a free number for a persona, preferring the clinic's area code. Returns null if none is free. */
  async allocateNumber(assignmentId: string, preferredAreaCode: string | null, now: Date): Promise<string | null> {
    const { rows } = await this.db.query<{ e164: string }>(
      `UPDATE phone_numbers SET status = 'assigned', assignment_id = $1, available_after = NULL
       WHERE e164 = (
         SELECT e164 FROM phone_numbers
         WHERE status = 'available' OR (status = 'quarantined' AND available_after <= $2)
         ORDER BY (area_code = $3) DESC, available_after NULLS FIRST, e164
         LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING e164`,
      [assignmentId, now, preferredAreaCode ?? ""],
    );
    const e164 = rows[0]?.e164 ?? null;
    if (e164) await this.db.query("UPDATE persona_assignments SET phone_number = $2 WHERE id = $1", [assignmentId, e164]);
    return e164;
  }

  /** Puts a test's numbers into quarantine until `availableAfter`. */
  async releaseNumbers(testId: string, availableAfter: Date): Promise<number> {
    const { rows } = await this.db.query(
      `UPDATE phone_numbers SET status = 'quarantined', available_after = $2, assignment_id = NULL
       WHERE status = 'assigned' AND assignment_id IN (SELECT id FROM persona_assignments WHERE test_id = $1)
       RETURNING e164`,
      [testId, availableAfter],
    );
    return rows.length;
  }

  setNumberStatus(e164: string, status: PhoneNumber["status"]) {
    return this.one<PhoneNumber>("UPDATE phone_numbers SET status = $2 WHERE e164 = $1 RETURNING *", [e164, status]);
  }

  // ---------- Evidence ----------

  async saveEvidence(e: { testId: string; kind: string; contentType: string; data: Uint8Array }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      "INSERT INTO evidence_files (test_id, kind, content_type, data) VALUES ($1, $2, $3, $4) RETURNING id",
      [e.testId, e.kind, e.contentType, e.data],
    );
    return rows[0]!.id;
  }

  getEvidence(id: string) {
    return this.one<{ id: string; testId: string; kind: string; contentType: string; data: Uint8Array }>(
      "SELECT id, test_id, kind, content_type, data FROM evidence_files WHERE id = $1",
      [id],
    );
  }

  // ---------- Audit log ----------

  async audit(actor: string, action: string, subject?: { type: string; id: string } | null, details: Record<string, unknown> = {}) {
    await this.db.query("INSERT INTO audit_log (actor, action, subject_type, subject_id, details) VALUES ($1, $2, $3, $4, $5)", [
      actor,
      action,
      subject?.type ?? null,
      subject?.id ?? null,
      JSON.stringify(details),
    ]);
  }

  async hasAudit(action: string, subjectType: string, subjectId: string): Promise<boolean> {
    const { rows } = await this.db.query("SELECT 1 FROM audit_log WHERE action = $1 AND subject_type = $2 AND subject_id = $3 LIMIT 1", [action, subjectType, subjectId]);
    return rows.length > 0;
  }

  auditFor(subjectType: string, subjectId: string) {
    return this.many<AuditEntry>("SELECT * FROM audit_log WHERE subject_type = $1 AND subject_id = $2 ORDER BY at", [subjectType, subjectId]);
  }
}
