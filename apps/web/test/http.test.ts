import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/http";

const req = (xff?: string) => new Request("http://localhost/", { headers: xff ? { "x-forwarded-for": xff } : {} });

describe("clientIp", () => {
  it("ignores spoofed entries a client prepends, trusting the last proxy's entry", () => {
    expect(clientIp(req("1.2.3.4, 203.0.113.9"), 1)).toBe("203.0.113.9");
  });
  it("counts back one more hop behind a load balancer", () => {
    expect(clientIp(req("1.2.3.4, 203.0.113.9, 35.191.0.1"), 2)).toBe("203.0.113.9");
  });
  it("falls back sensibly with short or missing headers", () => {
    expect(clientIp(req("203.0.113.9"), 2)).toBe("203.0.113.9");
    expect(clientIp(req(), 1)).toBe("unknown");
  });
});
