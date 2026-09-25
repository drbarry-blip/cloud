"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/lead-token";

const LABELS = { personal: "Personal", auto_reply: "Auto-reply", marketing: "Marketing", reminder: "Reminder" } as const;

/** Lets staff correct a touch's label; grading counts only personal touches as human. */
export function LabelSelect({ eventId, label }: { eventId: string; label: keyof typeof LABELS }) {
  const router = useRouter();
  const [value, setValue] = useState(label);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <select
        aria-label="Label"
        value={value}
        style={{ minHeight: 32, padding: "2px 8px", width: "auto" }}
        onChange={async (e) => {
          const next = e.target.value as keyof typeof LABELS;
          setValue(next);
          const res = await postJson(`/api/admin/events/${eventId}`, { label: next });
          if (!res.ok) {
            setValue(label);
            setError(res.message);
          } else router.refresh();
        }}
      >
        {Object.entries(LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      {error ? <span className="error-text small"> {error}</span> : null}
    </span>
  );
}
