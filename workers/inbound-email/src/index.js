// Cloudflare Email Worker: receives mail for the persona domains (catch-all route),
// forwards the parts we need to the app, signed with INBOUND_EMAIL_SECRET.
// Attachment contents are never forwarded; only their file names (for the PHI tripwire).
import PostalMime from "postal-mime";

const KEEP_HEADERS = [
  "auto-submitted",
  "x-autoreply",
  "x-autorespond",
  "x-auto-response-suppress",
  "precedence",
  "list-unsubscribe",
  "content-type",
  "in-reply-to",
  "references",
];

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async email(message, env) {
    const email = await PostalMime.parse(await new Response(message.raw).arrayBuffer());
    const headers = {};
    for (const h of email.headers ?? []) {
      const key = h.key.toLowerCase();
      if (KEEP_HEADERS.includes(key)) headers[key] = String(h.value).slice(0, 2000);
    }
    const body = JSON.stringify({
      to: message.to,
      from: email.from?.address ? `${email.from.name ?? ""} <${email.from.address}>`.trim() : message.from,
      subject: email.subject ?? null,
      text: email.text ?? null,
      html: email.text ? null : email.html ?? null,
      headers,
      messageId: email.messageId ?? null,
      receivedAt: new Date().toISOString(),
      attachmentNames: (email.attachments ?? []).map((a) => a.filename).filter(Boolean).slice(0, 50),
    });
    const t = Math.floor(Date.now() / 1000);
    const signature = await hmacHex(env.INBOUND_EMAIL_SECRET, `${t}.${body}`);
    const res = await fetch(env.INBOUND_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-inbound-signature": `t=${t},v1=${signature}` },
      body,
    });
    if (!res.ok) {
      // Don't lose a clinic's reply: keep a copy in the backup mailbox for a VA to enter.
      if (env.FALLBACK_ADDRESS) await message.forward(env.FALLBACK_ADDRESS);
      else throw new Error(`App returned ${res.status}`);
    }
  },
};
