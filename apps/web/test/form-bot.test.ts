import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyField, playwrightFormBot } from "@/lib/shopper/form-bot";

const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

describe("classifyField", () => {
  const f = (hay: string, type = "text", tag = "input") => classifyField({ hay, type, tag });
  it("recognizes common contact-form fields", () => {
    expect(f("your-email Email Address", "email")).toBe("email");
    expect(f("phone Mobile number", "tel")).toBe("phone");
    expect(f("fname First Name")).toBe("first_name");
    expect(f("last_name Last name")).toBe("last_name");
    expect(f("name Your Name")).toBe("full_name");
    expect(f("comments How can we help?", "", "textarea")).toBe("message");
    expect(f("service Interested in", "", "select")).toBe("service");
    expect(f("sms_consent I agree to receive text messages", "checkbox")).toBe("consent");
  });
  it("refuses fields personas never fill", () => {
    expect(f("dob Date of birth")).toBe("never");
    expect(f("insurance Insurance provider")).toBe("never");
    expect(f("street Street address")).toBe("never");
    expect(f("appt", "date")).toBe("never");
    expect(f("company Company name")).toBe("unknown");
  });
});

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Glow Clinic</title></head><body><footer>Thank you for choosing Glow Clinic</footer>${body}</body></html>`;
const contactForm = (action = "/thanks", extra = "") => `
  <h1>Contact us</h1>
  <form action="${action}" method="post">
    <label for="fn">First name</label><input id="fn" name="first_name" required>
    <label for="ln">Last name</label><input id="ln" name="last_name" required>
    <label for="em">Email</label><input id="em" type="email" name="email" required>
    <label for="ph">Phone</label><input id="ph" type="tel" name="phone">
    <label for="sv">Service</label><select id="sv" name="service"><option value="">Select…</option><option value="filler">Dermal filler</option><option value="botox">Botox</option></select>
    <label><input type="checkbox" name="newsletter"> Send me the newsletter</label>
    <input type="text" name="website_hp" style="display:none">
    <label for="msg">Message</label><textarea id="msg" name="message" required></textarea>
    ${extra}
    <button type="submit">Send</button>
  </form>`;

describe.skipIf(!existsSync(CHROMIUM))("form bot in a real browser", () => {
  let server: http.Server;
  let base = "";
  const posts: Record<string, string>[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url!, "http://x");
      const send = (html: string, status = 200) => {
        res.writeHead(status, { "Content-Type": "text/html" });
        res.end(html);
      };
      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          posts.push(Object.fromEntries(new URLSearchParams(body)));
          if (url.pathname === "/fail") return send(page(contactForm("/fail") + "<p class=error>Please enter a valid phone number.</p>"));
          send(page("<h1>Thank you! We'll be in touch within one business day.</h1>"));
        });
        return;
      }
      switch (url.pathname) {
        case "/contact":
          return send(page(contactForm()));
        case "/captcha":
          return send(page(contactForm("/thanks", '<div class="g-recaptcha" data-sitekey="abc"></div>')));
        case "/dob":
          return send(page(contactForm("/thanks", '<label for="dob">Date of birth</label><input id="dob" name="dob" required>')));
        case "/fail-form":
          return send(page(contactForm("/fail")));
        case "/inline":
          return send(
            page(`<div id="box"><form id="f"><input name="name" placeholder="Your name" required><input type="email" name="email" placeholder="Email" required><textarea name="message" placeholder="Message"></textarea><button type="submit">Send message</button></form></div>
            <script>document.getElementById("f").addEventListener("submit", e => { e.preventDefault(); document.getElementById("box").innerHTML = "<p>Thanks for reaching out! Your message has been sent.</p>"; });</script>`),
          );
        case "/embedded":
          return send(page(`<h1>Contact</h1><iframe src="/contact" width="600" height="700"></iframe>`));
        case "/none":
          return send(page("<p>Call us!</p>"));
        default:
          return send("not found", 404);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const bot = playwrightFormBot({ executablePath: CHROMIUM, allowPrivateNetwork: true, timeoutMs: 20_000 });
  const input = (path: string) => ({
    url: `${base}${path}`,
    persona: { firstName: "Jessica", lastName: "Miller", email: "jessica.miller42@personas.example.net", phone: "+15125550101" },
    subject: "Quick question",
    message: "Hi! How much is Botox?\n\nJessica",
    serviceName: "Botox / neurotoxin",
  });

  it("fills and submits a contact form, skipping hidden traps and marketing opt-ins", async () => {
    const result = await bot.submit(input("/contact"));
    expect(result).toMatchObject({ status: "submitted", confirmation: expect.stringMatching(/Thank you!/) });
    expect(result.screenshots!.map((s) => s.kind)).toEqual(["form_before", "form_after"]);
    const posted = posts[posts.length - 1]!;
    expect(posted).toMatchObject({ first_name: "Jessica", last_name: "Miller", email: "jessica.miller42@personas.example.net", phone: "(512) 555-0101", service: "botox", message: "Hi! How much is Botox?\r\n\r\nJessica", website_hp: "" });
    expect(posted.newsletter).toBeUndefined();
  });

  it("handles forms that confirm on the same page, and forms inside frames", async () => {
    expect(await bot.submit(input("/inline"))).toMatchObject({ status: "submitted", confirmation: expect.stringMatching(/Thanks for reaching out/) });
    expect(await bot.submit(input("/embedded"))).toMatchObject({ status: "submitted" });
  });

  it("hands off to a VA for CAPTCHAs, fields personas never fill, errors, and missing forms", async () => {
    expect(await bot.submit(input("/captcha"))).toMatchObject({ status: "needs_va", reason: expect.stringMatching(/CAPTCHA/) });
    expect(await bot.submit(input("/dob"))).toMatchObject({ status: "needs_va", reason: expect.stringMatching(/requires a field/) });
    expect(await bot.submit(input("/fail-form"))).toMatchObject({ status: "needs_va", reason: expect.stringMatching(/error|confirmation/) });
    expect(await bot.submit(input("/none"))).toMatchObject({ status: "needs_va", reason: expect.stringMatching(/No contact form/) });
  });

  it("never loads pages on private networks in production mode", async () => {
    const guarded = playwrightFormBot({ executablePath: CHROMIUM, timeoutMs: 10_000 });
    await expect(guarded.submit(input("/contact"))).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
  });
});
