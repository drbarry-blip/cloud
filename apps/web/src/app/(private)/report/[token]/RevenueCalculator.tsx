"use client";

import { useState } from "react";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Missed-revenue estimate with every assumption visible and editable (SPEC.md §7.1).
 * The starting "slow or missed" share comes from this test's own results.
 */
export function RevenueCalculator({ atRiskShare }: { atRiskShare: number }) {
  const [inquiries, setInquiries] = useState(40);
  const [atRisk, setAtRisk] = useState(Math.round(atRiskShare * 100));
  const [recovered, setRecovered] = useState(25);
  const [value, setValue] = useState(800);
  const monthly = inquiries * (atRisk / 100) * (recovered / 100) * value;
  const field = (id: string, label: string, v: number, set: (n: number) => void, suffix: string, hint: string, max = 100_000) => (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="hint">{hint}</span>
      </label>
      <div className="inline-add" style={{ alignItems: "center" }}>
        <input id={id} type="number" inputMode="decimal" min={0} max={max} value={v} onChange={(e) => set(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
        <span className="muted">{suffix}</span>
      </div>
    </div>
  );
  return (
    <div className="stack">
      {field("inq", "New-patient inquiries per month", inquiries, setInquiries, "per month", "(forms, emails, and calls)")}
      {field("risk", "Inquiries that got a slow reply or none", atRisk, setAtRisk, "%", "(from this test; edit if you know better)", 100)}
      {field("rec", "Of those, how many you'd win with faster follow-up", recovered, setRecovered, "%", "(a conservative guess)", 100)}
      {field("val", "Value of a new patient", value, setValue, "dollars", "(first-year revenue from a typical new patient)")}
      <p className="notice" style={{ margin: 0 }} aria-live="polite">
        About <strong>{usd(monthly)}</strong> a month, or <strong>{usd(monthly * 12)}</strong> a year, in new-patient revenue you could recover.
        <br />
        <span className="small muted">
          {inquiries} × {atRisk}% × {recovered}% × {usd(value)}. An estimate, not a promise.
        </span>
      </p>
    </div>
  );
}
