"use client";

import { DEFAULT_HOURS, WEEKDAYS, type Weekday } from "@cgs/core";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/lead-token";
import { Turnstile } from "@/components/Turnstile";

interface ClinicTypeOption {
  id: string;
  name: string;
  services: { id: string; name: string }[];
}
interface PlaceOption {
  id: string;
  name: string;
  address: string;
}
interface PlaceForSetup extends PlaceOption {
  website: string | null;
  phone: string | null;
  hours: Record<Weekday, { open: string; close: string } | null> | null;
  timezone: string | null;
}
interface Discovered {
  status: "ok" | "blocked_by_robots" | "unreachable";
  forms: { pageUrl: string; kind: "native" | "embedded"; provider: string | null }[];
  emails: string[];
}

type Hours = Record<Weekday, { open: string; close: string } | null>;

interface FormState {
  placeId: string | null;
  name: string;
  address: string;
  website: string;
  phone: string;
  clinicType: string;
  services: string[];
  timezone: string;
  formUrls: string[];
  publicEmail: string;
  hours: Hours;
  blackoutDates: string[];
  ownerStandard: string;
  bookingLink: string;
  email: string;
  marketingConsent: boolean;
  ownsClinic: boolean;
  authorizesInquiries: boolean;
  willDeleteLeads: boolean;
}

const EMPTY: FormState = {
  placeId: null,
  name: "",
  address: "",
  website: "",
  phone: "",
  clinicType: "",
  services: [],
  timezone: "",
  formUrls: [],
  publicEmail: "",
  hours: DEFAULT_HOURS,
  blackoutDates: [],
  ownerStandard: "",
  bookingLink: "",
  email: "",
  marketingConsent: false,
  ownsClinic: false,
  authorizesInquiries: false,
  willDeleteLeads: false,
};

const STEPS = ["Find your clinic", "Clinic details", "Where patients reach you", "Hours and closures", "Your standard", "Authorize and pay"];
const DAY_LABELS: Record<Weekday, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const SAVE_KEY = "cgs.shopperSetup";

const withScheme = (url: string) => (!url.trim() || /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);

// The draft is kept in this tab so returning from a cancelled checkout doesn't lose it.
function loadDraft(): FormState | null {
  try {
    const raw = window.sessionStorage.getItem(SAVE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<FormState>) } : null;
  } catch {
    return null;
  }
}
function saveDraft(form: FormState) {
  try {
    window.sessionStorage.setItem(SAVE_KEY, JSON.stringify(form));
  } catch {
    /* storage unavailable */
  }
}

export function StartWizard(props: {
  clinicTypes: ClinicTypeOption[];
  timezones: readonly { id: string; label: string }[];
  googleEnabled: boolean;
  turnstileSiteKey: string | null;
  priceLabel: string;
  cancelled: boolean;
}) {
  const { clinicTypes, timezones, googleEnabled } = props;
  const [step, setStep] = useState(googleEnabled ? 0 : 1);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceOption[] | null>(null);
  const [discovered, setDiscovered] = useState<Discovered | null>(null);
  const [discoveredFor, setDiscoveredFor] = useState<string | null>(null);
  const [extraForm, setExtraForm] = useState("");
  const [otherEmail, setOtherEmail] = useState(false);
  const [newBlackout, setNewBlackout] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const draft = loadDraft();
    if (draft && draft.name) {
      setForm(draft);
      setStep(1);
    }
  }, []);

  useEffect(() => saveDraft(form), [form]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setMessage(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const clinicType = clinicTypes.find((c) => c.id === form.clinicType);
  const go = (next: number) => {
    setMessage(null);
    setStep(next);
  };

  // Look for forms and emails once per website, when the owner reaches that step.
  useEffect(() => {
    if (step !== 2) return;
    const site = withScheme(form.website);
    if (!site || discoveredFor === site) return;
    setDiscoveredFor(site);
    setBusy("discover");
    void postJson<Discovered>("/api/shopper/discover", { website: site }).then((res) => {
      setBusy(null);
      if (!res.ok) return setDiscovered({ status: "unreachable", forms: [], emails: [] });
      setDiscovered(res.data);
      setForm((f) => ({
        ...f,
        formUrls: f.formUrls.length ? f.formUrls : res.data.forms.slice(0, 5).map((x) => x.pageUrl),
        publicEmail: f.publicEmail || res.data.emails[0] || "",
      }));
    });
  }, [step, form.website, discoveredFor]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    setMessage(null);
    const res = await postJson<{ places: PlaceOption[] }>("/api/places/search", { query });
    setBusy(null);
    if (!res.ok) return setMessage(res.message);
    setPlaces(res.data.places);
  }

  async function pickPlace(p: PlaceOption) {
    setBusy(`place:${p.id}`);
    setMessage(null);
    const res = await postJson<{ place: PlaceForSetup }>("/api/shopper/place", { placeId: p.id });
    setBusy(null);
    if (!res.ok) {
      setForm((f) => ({ ...f, placeId: p.id, name: p.name, address: p.address }));
      setMessage(res.message);
    } else {
      const d = res.data.place;
      setForm((f) => ({
        ...f,
        placeId: d.id,
        name: d.name || p.name,
        address: d.address || p.address,
        website: d.website ?? "",
        phone: d.phone ?? "",
        hours: d.hours ?? f.hours,
        timezone: d.timezone ?? f.timezone,
        formUrls: [],
        publicEmail: "",
      }));
      setDiscoveredFor(null);
      setDiscovered(null);
    }
    setStep(1);
  }

  function validate(s: number): string | null {
    if (s === 1) {
      if (form.name.trim().length < 2) return "Enter the clinic's name.";
      if (!form.clinicType) return "Pick a clinic type.";
      if (form.services.length === 0) return "Pick at least one service to ask about.";
      if (!form.timezone) return "Pick the clinic's time zone.";
    }
    if (s === 2 && form.formUrls.length === 0 && !form.publicEmail.trim()) {
      return "We need at least one contact form or a public email address to send the inquiries to.";
    }
    if (s === 3 && !WEEKDAYS.some((d) => form.hours[d])) return "Enter the days and hours the clinic is open.";
    if (s === 3 && WEEKDAYS.some((d) => form.hours[d] && form.hours[d]!.open >= form.hours[d]!.close)) return "Each closing time must be after the opening time.";
    if (s === 5) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return "Enter your email address.";
      if (!form.ownsClinic || !form.authorizesInquiries || !form.willDeleteLeads) return "Please check all three boxes to continue.";
    }
    return null;
  }

  function next(e?: React.FormEvent) {
    e?.preventDefault();
    const problem = validate(step);
    if (problem) return setMessage(problem);
    go(step + 1);
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate(5);
    if (problem) return setMessage(problem);
    setBusy("pay");
    setMessage(null);
    const res = await postJson<{ checkoutUrl: string }>("/api/shopper/orders", {
      email: form.email.trim(),
      marketingConsent: form.marketingConsent,
      clinic: {
        placeId: form.placeId,
        name: form.name.trim(),
        address: form.address.trim() || null,
        website: form.website.trim() ? withScheme(form.website) : null,
        phone: form.phone.trim() || null,
        publicEmail: form.publicEmail.trim() || null,
        formUrls: form.formUrls,
        clinicType: form.clinicType,
        services: form.services,
        timezone: form.timezone,
        hours: form.hours,
        blackoutDates: form.blackoutDates,
        ownerStandard: form.ownerStandard.trim() || null,
        bookingLink: form.bookingLink.trim() ? withScheme(form.bookingLink) : null,
      },
      authorizations: { ownsClinic: true, authorizesInquiries: true, willDeleteLeads: true },
      turnstileToken: turnstileToken ?? undefined,
    });
    setResetSignal((n) => n + 1);
    if (!res.ok) {
      setBusy(null);
      return setMessage(res.message);
    }
    try {
      window.sessionStorage.removeItem(SAVE_KEY);
    } catch {
      /* storage unavailable */
    }
    window.location.assign(res.data.checkoutUrl);
  }

  const toggleService = (id: string) =>
    set("services", form.services.includes(id) ? form.services.filter((s) => s !== id) : form.services.length >= 3 ? form.services : [...form.services, id]);
  const toggleFormUrl = (url: string) => set("formUrls", form.formUrls.includes(url) ? form.formUrls.filter((u) => u !== url) : [...form.formUrls, url].slice(0, 5));
  const setDay = (d: Weekday, value: { open: string; close: string } | null) => set("hours", { ...form.hours, [d]: value });

  const header = (
    <>
      <ol className="steps" aria-hidden="true">
        {STEPS.map((s, i) => (
          <li key={s} className={i < step ? "done" : i === step ? "current" : ""} />
        ))}
      </ol>
      <p className="step-label">
        Step {step + 1} of {STEPS.length}
      </p>
      <h2 ref={headingRef} tabIndex={-1} style={{ marginTop: 0, outline: "none" }}>
        {STEPS[step]}
      </h2>
    </>
  );
  const error = message ? (
    <p className="error-text" role="alert">
      {message}
    </p>
  ) : null;
  const back = (to = step - 1) => (
    <button type="button" className="btn btn-secondary" onClick={() => go(to)}>
      Back
    </button>
  );

  return (
    <div className="stack">
      {props.cancelled ? <p className="notice">Checkout was cancelled, so you haven&apos;t been charged. Your details are still here.</p> : null}

      {step === 0 ? (
        <div className="card stack">
          {header}
          <form className="stack" onSubmit={search}>
            <div className="field">
              <label htmlFor="q">Your clinic&apos;s name and city</label>
              <input id="q" type="search" required minLength={3} maxLength={120} placeholder="e.g. Glow Med Spa, Austin TX" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div>
              <button className="btn btn-secondary" type="submit" disabled={busy !== null || query.trim().length < 3}>
                {busy === "search" ? "Searching…" : "Find my clinic"}
              </button>
            </div>
          </form>
          {places ? (
            places.length === 0 ? (
              <p className="notice">No matches. Try adding the city or street, or enter the details by hand.</p>
            ) : (
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {places.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="btn btn-secondary" style={{ width: "100%", textAlign: "left", display: "block" }} disabled={busy !== null} onClick={() => pickPlace(p)}>
                      {p.name}
                      <br />
                      <span className="small muted">{busy === `place:${p.id}` ? "Loading details…" : p.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {error}
          <p className="small">
            <button type="button" className="btn btn-small btn-secondary" onClick={() => go(1)}>
              Enter the details by hand
            </button>
          </p>
        </div>
      ) : null}

      {step === 1 ? (
        <form className="card" onSubmit={next} noValidate>
          {header}
          {form.placeId ? <p className="small muted">Filled in from Google. Check each field and fix anything that&apos;s out of date.</p> : null}
          <div className="field">
            <label htmlFor="name">Clinic name</label>
            <input id="name" type="text" maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="website">
              Website <span className="hint">(where your contact form is)</span>
            </label>
            <input id="website" type="url" inputMode="url" maxLength={300} placeholder="https://yourclinic.com" value={form.website} onChange={(e) => set("website", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="phone">Main phone number</label>
            <input id="phone" type="tel" maxLength={40} value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="address">Address</label>
            <input id="address" type="text" maxLength={300} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="timezone">Time zone</label>
            <select id="timezone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              <option value="">Choose…</option>
              {timezones.map((tz) => (
                <option key={tz.id} value={tz.id}>
                  {tz.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="clinicType">Clinic type</label>
            <select
              id="clinicType"
              value={form.clinicType}
              onChange={(e) => setForm((f) => ({ ...f, clinicType: e.target.value, services: [] }))}
            >
              <option value="">Choose…</option>
              {clinicTypes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {clinicType ? (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
              <legend style={{ fontWeight: 600, marginBottom: 6 }}>
                Services to ask about <span className="hint">(pick 1 to 3; each fictional patient asks about a different one)</span>
              </legend>
              {clinicType.services.map((s) => (
                <label key={s.id} className="checkbox" style={{ marginBottom: 6 }}>
                  <input type="checkbox" checked={form.services.includes(s.id)} disabled={!form.services.includes(s.id) && form.services.length >= 3} onChange={() => toggleService(s.id)} />
                  <span>{s.name}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {error}
          <div className="form-actions">
            {googleEnabled ? back(0) : <span />}
            <button className="btn btn-primary" type="submit">
              Next
            </button>
          </div>
        </form>
      ) : null}

      {step === 2 ? (
        <form className="card" onSubmit={next} noValidate>
          {header}
          <p className="muted" style={{ marginTop: 0 }}>
            The fictional patients reach out the way real ones do: through your website&apos;s contact form and by email. We never use online booking tools.
          </p>
          {busy === "discover" ? <p className="notice" role="status">Checking your website for contact forms and email addresses…</p> : null}
          {discovered && discovered.status !== "ok" ? (
            <p className="notice notice-warn">We couldn&apos;t read your website automatically. Add your contact page and email below.</p>
          ) : null}

          <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Contact form pages</legend>
            {[...new Set([...(discovered?.forms.map((f) => f.pageUrl) ?? []), ...form.formUrls])].map((url) => {
              const found = discovered?.forms.find((f) => f.pageUrl === url);
              return (
                <label key={url} className="checkbox" style={{ marginBottom: 6 }}>
                  <input type="checkbox" checked={form.formUrls.includes(url)} onChange={() => toggleFormUrl(url)} />
                  <span style={{ wordBreak: "break-all" }}>
                    {url}
                    {found?.provider ? <span className="small muted"> ({found.provider} form)</span> : null}
                  </span>
                </label>
              );
            })}
            {discovered && discovered.forms.length === 0 && form.formUrls.length === 0 ? <p className="small muted">We didn&apos;t find a form. If you have one, add its page.</p> : null}
            <div className="inline-add" style={{ marginTop: 8 }}>
              <label htmlFor="extraForm" className="visually-hidden">
                Add a contact form page
              </label>
              <input id="extraForm" type="url" inputMode="url" placeholder="https://yourclinic.com/contact" value={extraForm} onChange={(e) => setExtraForm(e.target.value)} />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!extraForm.trim() || form.formUrls.length >= 5}
                onClick={() => {
                  const url = withScheme(extraForm);
                  if (!form.formUrls.includes(url)) set("formUrls", [...form.formUrls, url]);
                  setExtraForm("");
                }}
              >
                Add
              </button>
            </div>
          </fieldset>

          <fieldset style={{ border: 0, padding: 0, margin: "20px 0 0" }}>
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Public email address</legend>
            {(discovered?.emails ?? []).map((e) => (
              <label key={e} className="checkbox" style={{ marginBottom: 6 }}>
                <input
                  type="radio"
                  name="publicEmail"
                  checked={!otherEmail && form.publicEmail === e}
                  onChange={() => {
                    setOtherEmail(false);
                    set("publicEmail", e);
                  }}
                />
                <span>{e}</span>
              </label>
            ))}
            <label className="checkbox" style={{ marginBottom: 6 }}>
              <input type="radio" name="publicEmail" checked={otherEmail || (!!form.publicEmail && !(discovered?.emails ?? []).includes(form.publicEmail))} onChange={() => setOtherEmail(true)} />
              <span>A different address</span>
            </label>
            {otherEmail || (!!form.publicEmail && !(discovered?.emails ?? []).includes(form.publicEmail)) ? (
              <input type="email" aria-label="Public email address" placeholder="hello@yourclinic.com" value={form.publicEmail} onChange={(e) => set("publicEmail", e.target.value)} />
            ) : null}
            <label className="checkbox">
              <input
                type="radio"
                name="publicEmail"
                checked={!otherEmail && !form.publicEmail}
                onChange={() => {
                  setOtherEmail(false);
                  set("publicEmail", "");
                }}
              />
              <span>We don&apos;t list a public email</span>
            </label>
            <p className="hint">Use the address a new patient would find on your website or Google listing.</p>
          </fieldset>
          {error}
          <div className="form-actions">
            {back()}
            <button className="btn btn-primary" type="submit" disabled={busy === "discover"}>
              Next
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <form className="card" onSubmit={next} noValidate>
          {header}
          <p className="muted" style={{ marginTop: 0 }}>
            We time inquiries around your real hours and grade response times in business hours, so these matter.
          </p>
          <div role="group" aria-label="Opening hours">
            {WEEKDAYS.map((d) => {
              const h = form.hours[d];
              return (
                <div key={d} className="hours-row">
                  <span className="day">{DAY_LABELS[d]}</span>
                  <label className="checkbox">
                    <input type="checkbox" checked={!h} onChange={(e) => setDay(d, e.target.checked ? null : { open: "09:00", close: "17:00" })} />
                    <span className="small">Closed</span>
                  </label>
                  {h ? (
                    <span className="times">
                      <input type="time" aria-label={`${DAY_LABELS[d]} opens`} value={h.open} onChange={(e) => setDay(d, { ...h, open: e.target.value })} />
                      <span aria-hidden="true">–</span>
                      <input type="time" aria-label={`${DAY_LABELS[d]} closes`} value={h.close} onChange={(e) => setDay(d, { ...h, close: e.target.value })} />
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="field" style={{ marginTop: 20 }}>
            <label htmlFor="blackout">
              Closures <span className="hint">(vacations or events; federal holidays are skipped automatically)</span>
            </label>
            <div className="inline-add">
              <input id="blackout" type="date" value={newBlackout} onChange={(e) => setNewBlackout(e.target.value)} />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!newBlackout}
                onClick={() => {
                  if (!form.blackoutDates.includes(newBlackout)) set("blackoutDates", [...form.blackoutDates, newBlackout].sort());
                  setNewBlackout("");
                }}
              >
                Add
              </button>
            </div>
            {form.blackoutDates.length ? (
              <ul className="chips">
                {form.blackoutDates.map((d) => (
                  <li key={d}>
                    {d}
                    <button type="button" aria-label={`Remove ${d}`} onClick={() => set("blackoutDates", form.blackoutDates.filter((x) => x !== d))}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {error}
          <div className="form-actions">
            {back()}
            <button className="btn btn-primary" type="submit">
              Next
            </button>
          </div>
        </form>
      ) : null}

      {step === 4 ? (
        <form className="card" onSubmit={next} noValidate>
          {header}
          <div className="field">
            <label htmlFor="standard">
              What is your front desk supposed to do with a new lead? <span className="hint">(optional)</span>
            </label>
            <textarea
              id="standard"
              maxLength={1000}
              placeholder="e.g. Call within 15 minutes during business hours, text if there's no answer, and follow up for a week."
              value={form.ownerStandard}
              onChange={(e) => set("ownerStandard", e.target.value)}
            />
            <p className="hint">Your report will compare what actually happened with your own standard.</p>
          </div>
          <div className="field">
            <label htmlFor="booking">
              Online booking link <span className="hint">(optional; used in your fix-it scripts)</span>
            </label>
            <input id="booking" type="url" inputMode="url" maxLength={500} placeholder="https://…" value={form.bookingLink} onChange={(e) => set("bookingLink", e.target.value)} />
          </div>
          {error}
          <div className="form-actions">
            {back()}
            <button className="btn btn-primary" type="submit">
              Next
            </button>
          </div>
        </form>
      ) : null}

      {step === 5 ? (
        <form className="card" onSubmit={pay} noValidate>
          {header}
          <ul className="summary">
            <li>
              <span>Clinic</span>
              <strong>{form.name}</strong>
            </li>
            <li>
              <span>Services</span>
              <span style={{ textAlign: "right" }}>{form.services.map((id) => clinicType?.services.find((s) => s.id === id)?.name ?? id).join(", ")}</span>
            </li>
            <li>
              <span>Inquiries</span>
              <span>3 fictional new patients over about 4 days</span>
            </li>
            <li>
              <span>Baseline Test</span>
              <strong>{props.priceLabel}</strong>
            </li>
          </ul>

          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="email">
              Your email <span className="hint">(for your receipt and report; an address at your clinic&apos;s website domain verifies you fastest)</span>
            </label>
            <input id="email" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: "16px 0 0" }} className="stack">
            <legend style={{ fontWeight: 600, marginBottom: 6 }}>Authorization</legend>
            <label className="checkbox">
              <input type="checkbox" checked={form.ownsClinic} onChange={(e) => set("ownsClinic", e.target.checked)} />
              <span>I own or manage this clinic.</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.authorizesInquiries} onChange={(e) => set("authorizesInquiries", e.target.checked)} />
              <span>I authorize fictional new-patient inquiries to this clinic through its website form and email.</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.willDeleteLeads} onChange={(e) => set("willDeleteLeads", e.target.checked)} />
              <span>I&apos;ll delete the test leads from our systems afterward (the report includes a cleanup list).</span>
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={form.marketingConsent} onChange={(e) => set("marketingConsent", e.target.checked)} />
              <span className="muted">Optional: send me occasional tips on converting more inquiries. Unsubscribe any time.</span>
            </label>
          </fieldset>
          <p className="small muted">
            Before the test starts, we verify that you own or manage the clinic. If we can&apos;t, you get a full refund. By continuing you agree to the{" "}
            <a href="/terms">terms</a>.
          </p>
          <Turnstile siteKey={props.turnstileSiteKey} onToken={setTurnstileToken} resetSignal={resetSignal} />
          {error}
          <div className="form-actions">
            {back()}
            <button className="btn btn-primary" type="submit" disabled={busy === "pay"}>
              {busy === "pay" ? "Starting checkout…" : `Continue to payment (${props.priceLabel})`}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
