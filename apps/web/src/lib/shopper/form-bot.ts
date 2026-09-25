import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";
import type { Browser, BrowserContext, Frame, Page } from "playwright-core";
import { isPublicAddress } from "../crawl";

// Submits a clinic's website contact form as a persona, with before/after
// screenshots. Anything unusual (a CAPTCHA, a required field personas never fill,
// no clear confirmation) hands the job to a VA instead of guessing. Personas never
// use booking widgets, never give a date of birth, insurance, or an address.

export interface FormSubmissionInput {
  url: string;
  persona: { firstName: string; lastName: string; email: string; phone: string | null };
  subject: string;
  message: string;
  serviceName: string;
}

export interface FormSubmission {
  status: "submitted" | "needs_va";
  reason?: string;
  confirmation?: string | null;
  /** Which kinds of fields were filled (never their values). */
  filled?: string[];
  screenshots?: { kind: "form_before" | "form_after"; png: Uint8Array }[];
}

export interface FormBot {
  submit(input: FormSubmissionInput): Promise<FormSubmission>;
}

interface FieldInfo {
  index: number;
  tag: string;
  type: string;
  hay: string;
  required: boolean;
  options: { value: string; text: string }[];
  radioGroup: string | null;
}

export type FieldRole =
  | "email"
  | "phone"
  | "first_name"
  | "last_name"
  | "full_name"
  | "message"
  | "subject"
  | "service"
  | "contact_method"
  | "consent"
  | "never"
  | "unknown";

// Things personas never provide (playbook persona-rules `never`, and no address).
const NEVER = /\b(?:dob|date.?of.?birth|birth.?date|birthday|ssn|social.?security|insurance|member.?id|policy|address|street|city|state|zip|postal|card|payment|medication|medical.?history|diagnos|age)\b/;

/** What a form field is for, from its name, id, label, placeholder, and type. */
export function classifyField(f: Pick<FieldInfo, "tag" | "type" | "hay">): FieldRole {
  const hay = f.hay.toLowerCase().replace(/[_-]+/g, " ");
  if (f.type === "email" || /\be ?mail\b/.test(hay)) return "email";
  if (f.type === "tel" || /\b(?:phone|mobile|cell|telephone|tel)\b/.test(hay)) return "phone";
  if (f.type === "date" || NEVER.test(hay)) return "never";
  if (f.type === "checkbox") return /\b(?:consent|agree|terms|privacy|contact me|permission|authorize|sms|text messages?)\b/.test(hay) ? "consent" : "unknown";
  if (f.type === "radio") return /\b(?:contact|prefer|reach|method)\b/.test(hay) ? "contact_method" : "unknown";
  if (/\bfirst ?name\b|\bfname\b|\bgiven\b/.test(hay)) return "first_name";
  if (/\blast ?name\b|\blname\b|\bsurname\b|\bfamily ?name\b/.test(hay)) return "last_name";
  if (f.tag === "select") return /\b(?:service|treatment|interest|interested|procedure|reason|concern|looking for)\b/.test(hay) ? "service" : "unknown";
  if (f.tag === "textarea" || /\b(?:message|comments?|question|inquiry|enquiry|how can we help|details|notes|tell us)\b/.test(hay)) return "message";
  if (/\b(?:full ?name|your ?name|name)\b/.test(hay) && !/\b(?:company|business|practice|user)\b/.test(hay)) return "full_name";
  if (/\b(?:subject|topic|regarding)\b/.test(hay)) return "subject";
  return "unknown";
}

const CAPTCHA_SELECTOR =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]';
const SUCCESS_TEXT = /\b(?:thank you|thanks for|thanks!|we(?:'|’)ve received|we have received|received your|we(?:'|’)ll be in touch|we will (?:be in touch|get back|contact)|message (?:has been |was )?sent|successfully (?:sent|submitted)|submission (?:received|successful))\b/i;
const ERROR_TEXT = /\b(?:is required|required field|please (?:fill|enter|complete|correct)|invalid|there was (?:a|an) (?:error|problem)|failed to send)\b/i;
const REALISTIC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Blocks requests to private networks (the browser runs inside our infrastructure). */
async function guardNetwork(context: BrowserContext) {
  const cache = new Map<string, boolean>();
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.abort("blockedbyclient");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let ok = cache.get(host);
    if (ok === undefined) {
      try {
        const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
        ok = addrs.length > 0 && addrs.every((a) => isPublicAddress(a.address));
      } catch {
        ok = false;
      }
      cache.set(host, ok);
    }
    return ok ? route.continue() : route.abort("blockedbyclient");
  });
}

async function collectFields(frame: Frame, formIndex: number): Promise<FieldInfo[]> {
  return frame.evaluate((fi) => {
    const form = document.querySelectorAll("form")[fi]!;
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
    };
    const labelFor = (el: HTMLElement) => {
      const id = el.id;
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? "" : "";
      const wrap = el.closest("label")?.textContent ?? "";
      const group = el.closest("fieldset")?.querySelector("legend")?.textContent ?? "";
      return `${byFor} ${wrap} ${group}`;
    };
    return [...form.querySelectorAll("input, textarea, select")].flatMap((node, index) => {
      const el = node as HTMLInputElement;
      const type = (el.getAttribute("type") ?? (el.tagName === "INPUT" ? "text" : "")).toLowerCase();
      if (["hidden", "submit", "button", "reset", "image", "file", "search", "password"].includes(type)) return [];
      if (el.disabled || el.readOnly || !visible(el)) return [];
      const hay = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("autocomplete"), el.getAttribute("aria-label"), labelFor(el)].filter(Boolean).join(" ");
      const options = el.tagName === "SELECT" ? [...(el as unknown as HTMLSelectElement).options].map((o) => ({ value: o.value, text: o.textContent?.trim() ?? "" })) : [];
      return [{ index, tag: el.tagName.toLowerCase(), type, hay, required: el.required || el.getAttribute("aria-required") === "true", options, radioGroup: type === "radio" ? el.name || null : null }];
    });
  }, formIndex);
}

/** Finds the page's contact form: one with a message box or a phone field, in the page or an embedded frame. */
async function findForm(page: Page): Promise<{ frame: Frame; formIndex: number } | null> {
  for (const frame of page.frames()) {
    const index = await frame
      .evaluate(() =>
        [...document.querySelectorAll("form")].findIndex((f) => {
          if (f.getAttribute("role") === "search" || f.querySelector('input[type="search"]')) return false;
          return Boolean(f.querySelector("textarea, input[type='tel']"));
        }),
      )
      .catch(() => -1);
    if (index >= 0) return { frame, formIndex: index };
  }
  return null;
}

const serviceWords = (name: string) =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

function pickOption(options: FieldInfo["options"], serviceName: string): string | null {
  const real = options.filter((o) => o.value && !/^(?:select|choose|please|--|-)/i.test(o.text));
  const words = serviceWords(serviceName);
  const match = real.find((o) => words.some((w) => o.text.toLowerCase().includes(w)));
  return (match ?? real.find((o) => /other|general|consult/i.test(o.text)) ?? real[0])?.value ?? null;
}

export function playwrightFormBot(opts: { wsEndpoint?: string; executablePath?: string; allowPrivateNetwork?: boolean; timeoutMs?: number }): FormBot {
  const timeout = opts.timeoutMs ?? 30_000;
  return {
    async submit(input) {
      const { chromium } = await import("playwright-core");
      let browser: Browser | null = null;
      const needsVa = (reason: string, extra: Partial<FormSubmission> = {}): FormSubmission => ({ status: "needs_va", reason, ...extra });
      try {
        browser = opts.wsEndpoint
          ? await chromium.connectOverCDP(opts.wsEndpoint, { timeout })
          : await chromium.launch({ executablePath: opts.executablePath, headless: true });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: REALISTIC_UA, locale: "en-US" });
        if (!opts.allowPrivateNetwork) await guardNetwork(context);
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        const screenshots: FormSubmission["screenshots"] = [];

        const response = await page.goto(input.url, { waitUntil: "domcontentloaded", timeout });
        if (!response || response.status() >= 400) return needsVa(`The form page returned ${response?.status() ?? "no response"}.`);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

        const found = await findForm(page);
        if (!found) return needsVa("No contact form was found on the page.");
        const { frame, formIndex } = found;
        const form = frame.locator("form").nth(formIndex);
        await form.scrollIntoViewIfNeeded().catch(() => {});
        screenshots.push({ kind: "form_before", png: await page.screenshot({ fullPage: true }) });
        if ((await frame.locator(CAPTCHA_SELECTOR).count()) > 0 || (await page.locator(CAPTCHA_SELECTOR).count()) > 0) {
          return needsVa("The form has a CAPTCHA, so a person needs to submit it.", { screenshots });
        }

        const fields = await collectFields(frame, formIndex);
        const inputs = form.locator("input, textarea, select");
        const filled: string[] = [];
        const done = new Set<string>();
        for (const f of fields) {
          const role = classifyField(f);
          const el = inputs.nth(f.index);
          const fill = async (value: string) => {
            await el.fill(value);
            filled.push(role);
          };
          if (role === "never" || role === "unknown") {
            if (f.required && f.type !== "checkbox") return needsVa(`The form requires a field personas don't fill (${f.hay.trim().slice(0, 60) || f.type}).`, { screenshots });
            if (f.required && f.type === "checkbox") await el.check();
            continue;
          }
          if (role === "email") await fill(input.persona.email);
          else if (role === "phone") {
            if (input.persona.phone) await fill(input.persona.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3"));
            else if (f.required) return needsVa("The form requires a phone number and this persona has none.", { screenshots });
          } else if (role === "first_name") await fill(input.persona.firstName);
          else if (role === "last_name") await fill(input.persona.lastName);
          else if (role === "full_name") await fill(`${input.persona.firstName} ${input.persona.lastName}`);
          else if (role === "message") await fill(input.message);
          else if (role === "subject") await fill(input.subject);
          else if (role === "service") {
            const value = pickOption(f.options, input.serviceName);
            if (value) {
              await el.selectOption(value);
              filled.push(role);
            }
          } else if (role === "consent") {
            // Only what the form requires; never opt in to marketing or texts otherwise.
            if (f.required) await el.check();
          } else if (role === "contact_method" && f.radioGroup && !done.has(f.radioGroup)) {
            if (/e ?mail/i.test(f.hay)) {
              await el.check();
              done.add(f.radioGroup);
            }
          }
        }
        if (!filled.includes("email")) return needsVa("Couldn't find the email field.", { screenshots });
        if (!filled.includes("message")) return needsVa("Couldn't find a message box.", { screenshots });

        const bodyText = async (f: Frame) => (await f.locator("body").innerText({ timeout: 2000 }).catch(() => "")) ?? "";
        const beforeText = `${await bodyText(frame)}\n${frame === page.mainFrame() ? "" : await bodyText(page.mainFrame())}`;
        const beforeUrls = new Set([page.url(), frame.url()]);
        const submit = form.locator('button[type="submit"], input[type="submit"], button:not([type])').filter({ hasNotText: /book now|schedule now/i });
        if ((await submit.count()) === 0) return needsVa("Couldn't find the form's send button.", { screenshots });
        await submit.first().click();

        // Only text that wasn't on the page before counts (a footer "thank you" must not look like success).
        const seen = new Set(beforeText.split("\n").map((l) => l.trim()));
        const fresh = async () => {
          const frames = page.frames().includes(frame) && frame !== page.mainFrame() ? [frame, page.mainFrame()] : [page.mainFrame()];
          const text = (await Promise.all(frames.map(bodyText))).join("\n");
          return text
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !seen.has(l))
            .join("\n");
        };
        const thanksUrl = () => [page.url(), frame.url()].some((u) => !beforeUrls.has(u) && /thank|success|confirm/i.test(u));
        // Wait for a confirmation, an error, or a thank-you page (forms post, redirect, or update in place).
        let newText = "";
        for (const deadline = Date.now() + 12_000; ; ) {
          await page.waitForTimeout(500);
          newText = await fresh();
          if (SUCCESS_TEXT.test(newText) || ERROR_TEXT.test(newText) || thanksUrl() || Date.now() > deadline) break;
        }
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        screenshots.push({ kind: "form_after", png: await page.screenshot({ fullPage: true }) });
        const success = SUCCESS_TEXT.exec(newText) ?? (thanksUrl() ? [page.url()] : null);
        if (!success) {
          const problem = ERROR_TEXT.exec(newText);
          return needsVa(problem ? `The form showed an error after sending: "${problem[0]}".` : "No confirmation appeared after sending. Check whether it went through.", {
            screenshots,
            filled,
          });
        }
        const line = newText.split("\n").find((l) => SUCCESS_TEXT.test(l))?.trim() ?? success[0];
        return { status: "submitted", confirmation: line.slice(0, 300), filled, screenshots };
      } finally {
        await browser?.close().catch(() => {});
      }
    },
  };
}
