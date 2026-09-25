import { describe, expect, it } from "vitest";
import { decodeCloudflareEmail, discoverContactRoutes } from "../src/detect";
import { emailMatchesWebsite, guessTimezone, normalizeUsPhone, stateFromAddress, websiteHost, weeklyHoursFromGoogle } from "../src/shopper";
import { playbook } from "./helpers";

const signatures = playbook.visibilityScore.embedded_form_signatures;

// Cloudflare-obfuscated "info@glowclinic.example" with key 0x42.
const cf = (email: string, key = 0x42) =>
  key.toString(16).padStart(2, "0") + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");

describe("discoverContactRoutes", () => {
  it("finds contact forms and public emails, ignoring newsletter boxes and junk addresses", () => {
    const home = {
      url: "https://www.glowclinic.example/",
      html: `<html><body>
        <form><input type="text" name="name"><input type="email" name="email"><button>Subscribe</button></form>
        <p>Email us at Hello@GlowClinic.example or call.</p>
        <a href="mailto:frontdesk%40gmail.com?subject=Hi">Front desk</a>
        <img src="logo@2x.png"> <span>noreply@glowclinic.example</span>
        <script>var dsn = "abc@o123.ingest.sentry.io";</script>
      </body></html>`,
    };
    const contact = {
      url: "https://www.glowclinic.example/contact",
      html: `<html><body>
        <form action="/send"><input name="name"><input type="email" name="email"><textarea name="message"></textarea></form>
        <a href="/cdn-cgi/l/email-protection#${cf("info@glowclinic.example")}">[email protected]</a>
      </body></html>`,
    };
    const book = { url: "https://www.glowclinic.example/book", html: `<iframe src="https://form.jotform.com/12345"></iframe>` };
    const routes = discoverContactRoutes([home, contact, book], { embeddedSignatures: signatures });
    expect(routes.forms).toEqual([
      { pageUrl: "https://www.glowclinic.example/contact", kind: "native", provider: null, fields: 3 },
      { pageUrl: "https://www.glowclinic.example/book", kind: "embedded", provider: "Jotform", fields: null },
    ]);
    expect(routes.emails).toEqual(["hello@glowclinic.example", "info@glowclinic.example", "frontdesk@gmail.com"]);
  });

  it("decodes Cloudflare-protected addresses and rejects garbage", () => {
    expect(decodeCloudflareEmail(cf("a@b.example", 0x1f))).toBe("a@b.example");
    expect(decodeCloudflareEmail("zz")).toBeNull();
    expect(decodeCloudflareEmail(cf("not an email"))).toBeNull();
  });
});

describe("clinic setup helpers", () => {
  it("reads the state from a US address and guesses the time zone", () => {
    expect(stateFromAddress("1 Main St, Austin, TX 78701, USA")).toBe("TX");
    expect(stateFromAddress("1 Main St, Austin, Texas")).toBeNull();
    const july = new Date("2026-07-01T12:00:00Z");
    expect(guessTimezone("1 Main St, Austin, TX 78701, USA", -300, july)).toBe("America/Chicago");
    // El Paso is on Mountain time: Google's offset picks the right zone in a split state.
    expect(guessTimezone("1 Mesa St, El Paso, TX 79901, USA", -360, july)).toBe("America/Denver");
    expect(guessTimezone("1 Camelback Rd, Phoenix, AZ 85016, USA", null, july)).toBe("America/Phoenix");
    expect(guessTimezone("Somewhere else")).toBeNull();
  });

  it("turns Google opening periods into weekly hours", () => {
    const hours = weeklyHoursFromGoogle([
      { open: { day: 1, hour: 9 }, close: { day: 1, hour: 12 } },
      { open: { day: 1, hour: 13 }, close: { day: 1, hour: 18, minute: 30 } },
      { open: { day: 6, hour: 10 }, close: { day: 0, hour: 0 } },
    ])!;
    expect(hours.mon).toEqual({ open: "09:00", close: "18:30" });
    expect(hours.sat).toEqual({ open: "10:00", close: "23:59" });
    expect(hours.sun).toBeNull();
    expect(weeklyHoursFromGoogle([{ open: { day: 0, hour: 0 } }])!.wed).toEqual({ open: "00:00", close: "23:59" });
    expect(weeklyHoursFromGoogle([])).toBeNull();
  });

  it("normalizes US phone numbers and website hosts", () => {
    expect(normalizeUsPhone("(512) 555-0123")).toBe("+15125550123");
    expect(normalizeUsPhone("+1 512 555 0123")).toBe("+15125550123");
    expect(normalizeUsPhone("555-0123")).toBeNull();
    expect(websiteHost("https://WWW.GlowClinic.example/contact")).toBe("glowclinic.example");
    expect(websiteHost("glowclinic.example")).toBe("glowclinic.example");
    expect(websiteHost("javascript:alert(1)")).toBeNull();
  });

  it("verifies ownership by email domain only for the clinic's own domain", () => {
    expect(emailMatchesWebsite("owner@glowclinic.example", "https://www.glowclinic.example")).toBe(true);
    expect(emailMatchesWebsite("owner@mail.glowclinic.example", "glowclinic.example")).toBe(true);
    expect(emailMatchesWebsite("owner@glowclinic.example", "https://austin.glowclinic.example")).toBe(true);
    expect(emailMatchesWebsite("owner@otherclinic.example", "https://glowclinic.example")).toBe(false);
    expect(emailMatchesWebsite("glowclinic@gmail.com", "https://glowclinic.example")).toBe(false);
    expect(emailMatchesWebsite("me@wixsite.com", "https://glow.wixsite.com/clinic")).toBe(false);
    expect(emailMatchesWebsite("owner@glowclinic.example", null)).toBe(false);
  });
});
