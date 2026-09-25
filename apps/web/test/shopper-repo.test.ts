import { DEFAULT_HOURS } from "@cgs/core";
import { describe, expect, it } from "vitest";
import { createLiteDb } from "@/lib/db";
import { ShopperRepo, type NewClinic } from "@/lib/shopper/repo";
import { SqlStore } from "@/lib/store/sql";

async function setup() {
  const db = await createLiteDb();
  const repo = new ShopperRepo(db);
  const store = new SqlStore(db);
  const owner = await store.upsertLead({ email: "owner@clinic.example", source: "secret_shopper_waitlist", marketingConsent: false });
  const clinic = await repo.createClinic(clinicInput(owner.id));
  return { db, repo, store, owner, clinic };
}

const clinicInput = (ownerLeadId: string, over: Partial<NewClinic> = {}): NewClinic => ({
  ownerLeadId,
  placeId: "place-1",
  name: "Test Clinic",
  address: "1 Main St, Austin, TX",
  website: "https://www.clinic.example/",
  websiteHost: "clinic.example",
  phone: "+15125550100",
  publicEmail: "hello@clinic.example",
  formUrls: ["https://www.clinic.example/contact"],
  clinicType: "med_spa",
  services: ["neurotoxin", "filler"],
  timezone: "America/Chicago",
  hours: DEFAULT_HOURS,
  blackoutDates: ["2026-10-12"],
  ownerStandard: null,
  bookingLink: null,
  ...over,
});

const newTest = (clinicId: string, status: "awaiting_payment" | "awaiting_verification" = "awaiting_payment") => ({
  clinicId,
  kind: "baseline" as const,
  status,
  scripts: ["silent", "engaged", "price_check"] as const,
  seed: 42,
  playbookVersion: "0.2.0-draft",
});

const assignment = (testId: string, email: string, scheduledAt: Date) => ({
  testId,
  script: "silent" as const,
  channel: "email" as const,
  serviceId: "neurotoxin",
  serviceName: "Botox / neurotoxin",
  sensitive: false,
  firstName: "Jessica",
  lastName: "Miller",
  sex: "female" as const,
  email,
  phoneNumber: null,
  subject: "Quick question",
  message: "Hi! How much is Botox?\n\nJessica",
  target: "hello@clinic.example",
  scheduledAt,
});

describe("shopper repository", () => {
  it("round-trips a clinic, with JSON hours and text arrays, and hides the verification code hash", async () => {
    const { repo, clinic } = await setup();
    await repo.setVerificationCodeHash(clinic.id, "hash");
    const got = (await repo.getClinic(clinic.id))!;
    expect(got.hours.mon).toEqual({ open: "09:00", close: "17:00" });
    expect(got.services).toEqual(["neurotoxin", "filler"]);
    expect(got.blackoutDates).toEqual(["2026-10-12"]);
    expect(got).not.toHaveProperty("verificationCodeHash");
    expect(await repo.verificationCodeHash(clinic.id)).toBe("hash");
    const verified = (await repo.setVerification(clinic.id, "verified", "email_domain", new Date("2026-10-01T00:00:00Z")))!;
    expect(verified.verifiedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(await repo.verificationCodeHash(clinic.id)).toBeNull();
  });

  it("marks an order paid once, so retried payment webhooks are harmless", async () => {
    const { repo, clinic, owner } = await setup();
    const order = await repo.createOrder({ clinicId: clinic.id, leadId: owner.id, product: "baseline", amountCents: 19900 });
    expect(await repo.markOrderPaid(order.id, { paidAt: new Date(), paymentIntent: "pi_1" })).not.toBeNull();
    expect(await repo.markOrderPaid(order.id, { paidAt: new Date(), paymentIntent: "pi_1" })).toBeNull();
    expect((await repo.getOrder(order.id))!.stripePaymentIntent).toBe("pi_1");
  });

  it("allows one active test per clinic and moves status only from the expected state", async () => {
    const { repo, clinic } = await setup();
    const a = (await repo.createTest(newTest(clinic.id, "awaiting_verification")))!;
    expect(a.scripts).toEqual(["silent", "engaged", "price_check"]);
    expect(await repo.createTest(newTest(clinic.id, "awaiting_verification"))).toBeNull();
    // An unpaid test doesn't count as active.
    const unpaid = (await repo.createTest(newTest(clinic.id)))!;
    expect(unpaid).not.toBeNull();
    // ...and can't become active while another test is.
    expect(await repo.transitionTest(unpaid.id, ["awaiting_payment"], "awaiting_verification")).toBeNull();

    expect(await repo.transitionTest(a.id, ["running"], "grading")).toBeNull();
    const scheduled = (await repo.transitionTest(a.id, ["awaiting_verification"], "scheduled", "Verified"))!;
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.statusNote).toBe("Verified");
    const delivered = (await repo.transitionTest(a.id, ["scheduled"], "delivered"))!;
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
  });

  it("finds the same location set up under another account", async () => {
    const { repo, store, clinic, owner } = await setup();
    const rival = await store.upsertLead({ email: "someone@else.example", source: "secret_shopper_waitlist", marketingConsent: false });
    const loc = { placeId: "place-1", websiteHost: "other.example" };
    expect(await repo.otherOwnersOfLocation(loc, rival.id)).toEqual([{ clinicId: clinic.id, ownerLeadId: owner.id }]);
    expect(await repo.otherOwnersOfLocation(loc, owner.id)).toEqual([]);
    expect(await repo.activeTestAtLocation(loc)).toBeNull();
    await repo.createTest(newTest(clinic.id, "awaiting_verification"));
    expect((await repo.activeTestAtLocation({ placeId: null, websiteHost: "clinic.example" }))!.clinicId).toBe(clinic.id);
  });

  it("hands each due inquiry to exactly one sender", async () => {
    const { repo, clinic } = await setup();
    const test = (await repo.createTest(newTest(clinic.id, "awaiting_verification")))!;
    const a = await repo.insertAssignment(assignment(test.id, "jessica.miller42@persona.example", new Date("2026-10-01T15:00:00Z")));
    const now = new Date("2026-10-01T16:00:00Z");
    expect(await repo.dueAssignments(now)).toEqual([]); // test not cleared to run yet
    await repo.transitionTest(test.id, ["awaiting_verification"], "scheduled");
    expect((await repo.dueAssignments(now)).map((x) => x.id)).toEqual([a.id]);
    const claims = await Promise.all([repo.claimAssignment(a.id), repo.claimAssignment(a.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const sent = (await repo.markSent(a.id, {
      sentAt: now,
      observeUntil: new Date("2026-10-11T16:00:00Z"),
      lateUntil: new Date("2026-10-15T16:00:00Z"),
      channel: "email",
      target: "hello@clinic.example",
      emailMessageId: "<m1@persona.example>",
    }))!;
    expect(sent.sendStatus).toBe("sent");
    expect(await repo.dueAssignments(now)).toEqual([]);
    expect((await repo.assignmentByEmail(" Jessica.Miller42@Persona.example"))!.id).toBe(a.id);
    expect(await repo.personaEmails()).toEqual(new Set(["jessica.miller42@persona.example"]));
  });

  it("caps persona replies", async () => {
    const { repo, clinic } = await setup();
    const test = (await repo.createTest(newTest(clinic.id, "awaiting_verification")))!;
    const a = await repo.insertAssignment(assignment(test.id, "p@persona.example", new Date()));
    const first = (await repo.recordPersonaReply(a.id, { at: new Date("2026-10-02T00:00:00Z"), messageId: "<r1>", maxReplies: 1 }))!;
    expect(first.repliesSent).toBe(1);
    expect(first.followUpSentAt).toEqual(new Date("2026-10-02T00:00:00Z"));
    expect(await repo.recordPersonaReply(a.id, { at: new Date(), messageId: "<r2>", maxReplies: 1 })).toBeNull();
  });

  it("stores each inbound message once, and merges call details as callbacks arrive", async () => {
    const { repo, clinic } = await setup();
    const test = (await repo.createTest(newTest(clinic.id, "awaiting_verification")))!;
    const a = await repo.insertAssignment(assignment(test.id, "p@persona.example", new Date()));
    const email = { assignmentId: a.id, channel: "email" as const, receivedAt: new Date(), body: "Hi Jessica!", externalId: "<abc@clinic>", headers: { "auto-submitted": "no" } };
    const first = await repo.insertInbound(email);
    const again = await repo.insertInbound(email);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.event.id).toBe(first.event.id);
    expect(again.event.headers).toEqual({ "auto-submitted": "no" });

    await repo.insertInbound({ assignmentId: a.id, channel: "call", receivedAt: new Date(), externalId: "CA1", fromAddr: "+15125550100" });
    await repo.updateCall("CA1", { voicemail: true, recordingUrl: "https://api.twilio.example/rec/RE1", durationSeconds: 31 });
    const call = (await repo.updateCall("CA1", { body: "Hi Jessica, this is the clinic..." }))!;
    expect(call).toMatchObject({ voicemail: true, recordingUrl: "https://api.twilio.example/rec/RE1", durationSeconds: 31, body: "Hi Jessica, this is the clinic..." });
    expect((await repo.inboundForTest(test.id)).map((e) => e.channel)).toEqual(["email", "call"]);
  });

  it("deletes the content of quarantined messages after the holding period", async () => {
    const { repo } = await setup();
    const { event } = await repo.insertInbound({ channel: "email", receivedAt: new Date(), body: "records", subject: "chart", externalId: "x1" });
    await repo.setPhiQuarantine(event.id, true);
    expect(await repo.purgeQuarantined(new Date(Date.now() - 60_000))).toBe(0);
    expect(await repo.purgeQuarantined(new Date(Date.now() + 60_000))).toBe(1);
    expect((await repo.getInbound(event.id))!).toMatchObject({ body: null, subject: null, phiQuarantined: true });
  });

  it("allocates numbers by area code and quarantines them after a test", async () => {
    const { repo, clinic } = await setup();
    await repo.addNumber("+13125550111");
    await repo.addNumber("+15125550199");
    expect(await repo.addNumber("+15125550199")).toBeNull();
    await expect(repo.addNumber("555-0199")).rejects.toThrow(/E\.164/);
    const test = (await repo.createTest(newTest(clinic.id, "awaiting_verification")))!;
    const a = await repo.insertAssignment(assignment(test.id, "a@persona.example", new Date()));
    const b = await repo.insertAssignment(assignment(test.id, "b@persona.example", new Date()));
    const c = await repo.insertAssignment(assignment(test.id, "c@persona.example", new Date()));
    const now = new Date("2026-10-01T00:00:00Z");
    expect(await repo.allocateNumber(a.id, "512", now)).toBe("+15125550199");
    expect(await repo.allocateNumber(b.id, "512", now)).toBe("+13125550111");
    expect(await repo.allocateNumber(c.id, "512", now)).toBeNull();
    expect((await repo.getAssignment(a.id))!.phoneNumber).toBe("+15125550199");
    expect((await repo.assignmentByPhone("+15125550199", new Date()))!.id).toBe(a.id);

    const until = new Date("2026-11-15T00:00:00Z");
    expect(await repo.releaseNumbers(test.id, until)).toBe(2);
    expect(await repo.allocateNumber(c.id, "512", new Date("2026-11-01T00:00:00Z"))).toBeNull();
    expect(await repo.allocateNumber(c.id, "512", until)).toBe("+15125550199");
  });

  it("tracks ops tasks and closes each one once", async () => {
    const { repo, clinic } = await setup();
    const test = (await repo.createTest(newTest(clinic.id, "awaiting_verification")))!;
    const task = await repo.createTask({ type: "verify_ownership", title: "Verify Test Clinic", testId: test.id, clinicId: clinic.id, payload: { why: "domain mismatch" } });
    expect(task.payload).toEqual({ why: "domain mismatch" });
    expect((await repo.openTaskFor("verify_ownership", { testId: test.id }))!.id).toBe(task.id);
    const now = new Date();
    expect(await repo.completeTask(task.id, { by: "va@us.example", minutesSpent: 4, resolution: "verified", at: now })).not.toBeNull();
    expect(await repo.completeTask(task.id, { by: "va@us.example", at: now })).toBeNull();
    await repo.createTask({ type: "submit_form", title: "Submit form", testId: test.id });
    await repo.createTask({ type: "qa_report", title: "QA", testId: test.id });
    expect(await repo.cancelOpenTasks({ testId: test.id, type: "submit_form" }, now, "test cancelled")).toBe(1);
    expect((await repo.openTasks()).map((t) => t.type)).toEqual(["qa_report"]);
  });

  it("writes an audit trail", async () => {
    const { repo, clinic } = await setup();
    await repo.audit("email:admin@us.example", "clinic.verified", { type: "clinic", id: clinic.id }, { method: "manual" });
    const log = await repo.auditFor("clinic", clinic.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: "email:admin@us.example", action: "clinic.verified", details: { method: "manual" } });
  });

  it("commits or rolls back repository work as one transaction", async () => {
    const { repo, clinic, owner } = await setup();
    await expect(
      repo.transaction(async (tx) => {
        await tx.createOrder({ clinicId: clinic.id, leadId: owner.id, product: "baseline", amountCents: 19900 });
        throw new Error("checkout failed");
      }),
    ).rejects.toThrow("checkout failed");
    const { rows } = await repo.db.query<{ n: number }>("SELECT count(*)::int AS n FROM orders");
    expect(rows[0]!.n).toBe(0);
  });
});
