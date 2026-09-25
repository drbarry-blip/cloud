import { describe, expect, it } from "vitest";
import { createToken, verifyToken } from "@/lib/tokens";

const secret = "test-secret";
const now = Date.UTC(2026, 8, 25);

describe("tokens", () => {
  it("round-trips a subject", () => {
    const t = createToken("unsubscribe", "lead-123", now, secret);
    expect(verifyToken(t, "unsubscribe", now, secret)).toBe("lead-123");
  });

  it("rejects the wrong purpose, a wrong secret, and tampering", () => {
    const t = createToken("confirm", "lead-123", now, secret);
    expect(verifyToken(t, "unsubscribe", now, secret)).toBeNull();
    expect(verifyToken(t, "confirm", now, "other-secret")).toBeNull();
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(Buffer.from(payload!, "base64url").toString().replace("lead-123", "lead-999")).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "confirm", now, secret)).toBeNull();
    expect(verifyToken("garbage", "confirm", now, secret)).toBeNull();
    expect(verifyToken(null, "confirm", now, secret)).toBeNull();
  });

  it("expires confirmation tokens after 14 days", () => {
    const t = createToken("confirm", "lead-123", now, secret);
    expect(verifyToken(t, "confirm", now + 13 * 86_400_000, secret)).toBe("lead-123");
    expect(verifyToken(t, "confirm", now + 15 * 86_400_000, secret)).toBeNull();
  });
});
