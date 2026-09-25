# Inbound email worker

Receives email sent to persona addresses and posts it to the app's
`/api/inbound/email` endpoint, signed with `INBOUND_EMAIL_SECRET`.

1. Add each persona domain to Cloudflare and turn on **Email Routing**.
2. `npm install`, then set `INBOUND_URL` in `wrangler.toml` to your app's URL.
3. `npx wrangler secret put INBOUND_EMAIL_SECRET` (the same value as the app's `INBOUND_EMAIL_SECRET`).
4. `npm run deploy`.
5. In Email Routing, set the **catch-all** rule for each persona domain to "Send to a Worker" → `cgs-inbound-email`.

Only message text, a few headers (for spotting auto-replies and threading), and
attachment file names are forwarded. Attachment contents never leave Cloudflare.
If the app can't be reached, the message goes to `FALLBACK_ADDRESS` (if set) so a
VA can enter it by hand; otherwise the worker errors and the sender gets a bounce.

Outgoing persona mail is sent through Resend. Verify each persona domain in
Resend and turn **off** open and click tracking for those domains: persona
emails must look like a person's, with no tracking pixels.
