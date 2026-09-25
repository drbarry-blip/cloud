import "server-only";
import { config } from "../config";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** One-click unsubscribe URL (RFC 8058). Required for marketing email. */
  unsubscribeUrl?: string;
}

/** Sends through Resend when configured; otherwise prints to the console (development). */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const email = config.email();
  const headers: Record<string, string> = {};
  if (message.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${message.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (!email) {
    console.info(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${email.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: email.from,
      to: [message.to],
      reply_to: email.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Email provider returned ${res.status}`);
}
