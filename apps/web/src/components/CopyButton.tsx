"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small btn-secondary no-print"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable: the text is still selectable */
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
      Save as PDF or print
    </button>
  );
}
