import { afterEach, describe, expect, it } from "vitest";
import { accountSessionToken, emailFromStaffLink, leadFromSession, sameOrigin, staffFromSession, staffLinkToken, staffSessionToken } from "@/lib/auth";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("sessions", () => {
  it("signs staff in by role, and signs them out as soon as they leave the list", () => {
    process.env.ADMIN_EMAILS = "boss@us.example";
    process.env.VA_EMAILS = "helper@us.example";
    expect(emailFromStaffLink(staffLinkToken("Helper@Us.example"))).toBe("helper@us.example");
    const session = staffSessionToken("helper@us.example");
    expect(staffFromSession(session)).toEqual({ email: "helper@us.example", role: "va" });
    expect(staffFromSession(staffSessionToken("boss@us.example"))).toEqual({ email: "boss@us.example", role: "admin" });
    process.env.VA_EMAILS = "";
    expect(staffFromSession(session)).toBeNull();
  });

  it("keeps customer and staff sessions apart", () => {
    process.env.ADMIN_EMAILS = "boss@us.example";
    const customer = accountSessionToken("7d1f0e3c-1111-4222-8333-444455556666");
    expect(leadFromSession(customer)).toBe("7d1f0e3c-1111-4222-8333-444455556666");
    expect(staffFromSession(customer)).toBeNull();
    expect(leadFromSession(staffSessionToken("boss@us.example"))).toBeNull();
    expect(emailFromStaffLink(customer)).toBeNull();
  });

  it("blocks cross-site posts", () => {
    process.env.SITE_URL = "https://app.example";
    const req = (headers: Record<string, string>) => new Request("https://app.example/api/x", { method: "POST", headers });
    expect(sameOrigin(req({ origin: "https://app.example" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(req({}))).toBe(false);
  });
});
