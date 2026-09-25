import "server-only";
import { config } from "../config";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Omit for plain-text-only mail (persona emails are plain text, like a person's). */
  html?: string;
  /** Defaults to EMAIL_FROM. Persona emails come from the persona's own address. */
  from?: string;
  /** Pass null to send without a Reply-To (persona emails). Defaults to EMAIL_REPLY_TO. */
  replyTo?: string | null;
  /** Extra headers, e.g. In-Reply-To and References for threading. */
  headers?: Record<string, string>;
  /** One-click unsubscribe URL (RFC 8058). Required for marketing email. */
  unsubscribeUrl?: string;
}

export interface SentEmail {
  /** The provider's message ID, when there is one. */
  id: string | null;
}

/** Sends through Resend when configured; otherwise prints to the console (development). */
export async function sendEmail(message: OutgoingEmail): Promise<SentEmail> {
  const email = config.email();
  const headers: Record<string, string> = { ...message.headers };
  if (message.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${message.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (!email) {
    console.info(`[email:dev] from=${message.from ?? "default"} to=${message.to} subject="${message.subject}"\n${message.text}\n`);
    return { id: null };
  }
  const replyTo = message.replyTo === undefined ? email.replyTo : message.replyTo ?? undefined;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${email.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: message.from ?? email.from,
      to: [message.to],
      reply_to: replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id ?? null };
}
