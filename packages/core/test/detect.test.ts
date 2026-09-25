import { describe, expect, it } from "vitest";
import { detectWebsiteSignals, findKeyPageLinks } from "../src/detect";
import { playbook } from "./helpers";

const rules = playbook.visibilityScore;

const home = `<!doctype html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://www.vagaro.com/resources/WidgetEmbeddedLoader/abc"></script>
</head><body>
  <header><nav><a href="/">Home</a><a href="/book">Book Now</a></nav></header>
  <a href="tel:+15551234567">(555) 123-4567</a>
  <a href="/contact">Contact us</a> <a href="/services/botox">Botox</a>
  <a href="https://other.example.com/contact">Partner</a>
</body></html>`;

const contact = `<html><body>
  <form role="search"><input type="search" name="q"></form>
  <form action="/send">
    <input type="text" name="name"><input type="email" name="email"><input type="tel" name="phone">
    <input type="hidden" name="token"><input type="checkbox" name="consent">
    <textarea name="message"></textarea><button type="submit">Send</button>
  </form>
  <script>window.tidioChatApi = "https://code.tidio.co/abc.js"</script>
</body></html>`;

describe("detectWebsiteSignals", () => {
  it("finds booking tools, tap-to-call, chat, form fields, and a top booking button", () => {
    const s = detectWebsiteSignals(
      [
        { url: "https://clinic.example.com/", html: home },
        { url: "https://clinic.example.com/contact", html: contact },
      ],
      rules,
    );
    expect(s).toEqual({
      https: true,
      mobileViewport: true,
      bookingTools: ["Vagaro"],
      chatWidgets: ["Tidio"],
      tapToCall: true,
      textLink: false,
      contactForm: 4,
      newPatientCtaAboveFold: true,
    });
  });

  it("reports an embedded third-party form when there's no native one", () => {
    const html = `<html><body><iframe src="https://form.jotform.com/12345"></iframe></body></html>`;
    const s = detectWebsiteSignals([{ url: "http://clinic.example.com/", html }], rules);
    expect(s.contactForm).toBe("embedded");
    expect(s.https).toBe(false);
    expect(s.mobileViewport).toBe(false);
    expect(s.newPatientCtaAboveFold).toBe(false);
  });

  it("reports no form when there is none", () => {
    const s = detectWebsiteSignals([{ url: "https://clinic.example.com/", html: "<html><body><p>Hi</p></body></html>" }], rules);
    expect(s.contactForm).toBe("none");
    expect(s.bookingTools).toEqual([]);
  });
});

describe("findKeyPageLinks", () => {
  it("keeps same-site contact, booking, and service links", () => {
    expect(findKeyPageLinks("https://clinic.example.com/", home)).toEqual([
      "https://clinic.example.com/book",
      "https://clinic.example.com/contact",
      "https://clinic.example.com/services/botox",
    ]);
  });
});
