import "server-only";
import { signTimestampedPayload, verifyTimestampedSignature } from "./signing";

// A small Stripe client over the REST API: Checkout, refunds, the customer portal,
// and webhook signature checks. Field reads accept both older and newer API
// shapes, so the account's default API version doesn't matter.

/** Encodes nested params the way Stripe expects: a[b][0][c]=v. */
export function encodeForm(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${key}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    else out.append(key, String(value));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out;
}

export class StripeError extends Error {
  override name = "StripeError";
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface CheckoutParams {
  mode: "payment" | "subscription";
  productName: string;
  amountCents: number;
  customerEmail?: string;
  /** Reuse an existing Stripe customer (e.g., adding retests after a baseline). */
  customerId?: string | null;
  clientReferenceId: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface StripeClient {
  createCheckoutSession(p: CheckoutParams): Promise<{ id: string; url: string }>;
  refund(paymentIntentId: string, amountCents?: number): Promise<{ id: string; status: string }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export function stripeClient(secretKey: string, fetchImpl: typeof fetch = fetch): StripeClient {
  async function call<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: params ? encodeForm(params).toString() : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    if (!res.ok) throw new StripeError(data.error?.message ?? `Stripe returned ${res.status}`, res.status, data.error?.code);
    return data as T;
  }

  return {
    async createCheckoutSession(p) {
      const priceData: Record<string, unknown> = { currency: "usd", unit_amount: p.amountCents, product_data: { name: p.productName } };
      if (p.mode === "subscription") priceData.recurring = { interval: "month" };
      const params: Record<string, unknown> = {
        mode: p.mode,
        client_reference_id: p.clientReferenceId,
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        metadata: p.metadata,
        line_items: [{ quantity: 1, price_data: priceData }],
        allow_promotion_codes: true,
      };
      if (p.customerId) params.customer = p.customerId;
      else if (p.customerEmail) params.customer_email = p.customerEmail;
      if (p.mode === "payment") {
        params.payment_intent_data = { metadata: p.metadata };
        if (!p.customerId) params.customer_creation = "always";
      } else {
        params.subscription_data = { metadata: p.metadata };
      }
      const s = await call<{ id: string; url: string }>("POST", "/checkout/sessions", params, p.idempotencyKey);
      return { id: s.id, url: s.url };
    },
    async refund(paymentIntentId, amountCents) {
      const r = await call<{ id: string; status: string }>("POST", "/refunds", { payment_intent: paymentIntentId, amount: amountCents }, `refund-${paymentIntentId}-${amountCents ?? "full"}`);
      return { id: r.id, status: r.status };
    },
    async createPortalSession(customerId, returnUrl) {
      const s = await call<{ url: string }>("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
      return { url: s.url };
    },
    async cancelSubscription(subscriptionId) {
      await call("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    },
  };
}

/** Checks a Stripe-Signature header against the raw body; rejects old signatures to stop replays. */
export const verifyStripeSignature = verifyTimestampedSignature;
/** For tests and local tooling: a valid signature header for a payload. */
export const signStripePayload = signTimestampedPayload;

// ---------- Reading webhook objects across API versions ----------

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "object" && v && typeof (v as Obj).id === "string" ? ((v as Obj).id as string) : null);

/** The subscription an invoice belongs to (top-level in older API versions, under `parent` in newer ones). */
export function invoiceSubscriptionId(invoice: Obj): string | null {
  const parent = invoice.parent as Obj | undefined;
  const details = parent?.subscription_details as Obj | undefined;
  return str(invoice.subscription) ?? str(details?.subscription);
}

/** A subscription's current period end (top-level in older API versions, per item in newer ones). */
export function subscriptionPeriodEnd(sub: Obj): Date | null {
  const items = ((sub.items as Obj | undefined)?.data as Obj[] | undefined) ?? [];
  const seconds = (sub.current_period_end as number | undefined) ?? (items[0]?.current_period_end as number | undefined);
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

export function subscriptionMetadata(invoice: Obj): Record<string, string> {
  const parent = invoice.parent as Obj | undefined;
  const details = parent?.subscription_details as Obj | undefined;
  return ((details?.metadata as Record<string, string> | undefined) ?? (invoice.subscription_details as Obj | undefined)?.metadata ?? {}) as Record<string, string>;
}

export const idOf = str;
