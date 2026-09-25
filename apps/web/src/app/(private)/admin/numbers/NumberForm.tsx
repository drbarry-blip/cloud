"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/components/lead-token";

export function NumberForm() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await postJson("/api/admin/numbers", { action: "add", number });
        if (!res.ok) return setMessage(res.message);
        setNumber("");
        setMessage(null);
        router.refresh();
      }}
    >
      <div className="inline-add">
        <label htmlFor="num" className="visually-hidden">Phone number</label>
        <input id="num" type="tel" placeholder="(512) 555-0123" value={number} onChange={(e) => setNumber(e.target.value)} />
        <button className="btn btn-primary" type="submit">Add</button>
      </div>
      {message ? <p className="error-text" role="alert">{message}</p> : null}
    </form>
  );
}
