import { describe, expect, it, vi } from "vitest";
import { encodeForm, invoiceSubscriptionId, signStripePayload, stripeClient, subscriptionPeriodEnd, verifyStripeSignature } from "@/lib/stripe";

describe("stripe webhooks", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts a valid signature and rejects tampering, wrong secrets, and replays", () => {
    const now = 1_790_000_000;
    const header = signStripePayload(body, secret, now);
    expect(verifyStripeSignature(body, header, secret, now)).toBe(true);
    expect(verifyStripeSignature(body.replace("evt_1", "evt_2"), header, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", now)).toBe(false);
    expect(verifyStripeSignature(body, header, secret, now + 301)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, "t=abc,v1=zz", secret, now)).toBe(false);
    // Stripe may send several v1 signatures while a secret is being rolled.
    expect(verifyStripeSignature(body, `${header},v1=${"0".repeat(64)}`, secret, now)).toBe(true);
  });

  it("reads subscription fields from both older and newer API shapes", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_old" })).toBe("sub_old");
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } })).toBe("sub_new");
    expect(invoiceSubscriptionId({})).toBeNull();
    expect(subscriptionPeriodEnd({ current_period_end: 1_790_000_000 })).toEqual(new Date(1_790_000_000_000));
    expect(subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1_790_000_000 }] } })).toEqual(new Date(1_790_000_000_000));
  });
});

describe("stripe client", () => {
  it("encodes nested params the way Stripe expects", () => {
    const form = encodeForm({ mode: "payment", line_items: [{ quantity: 1, price_data: { unit_amount: 19900 } }], skip: null, metadata: { orderId: "o1" } });
    expect(form.toString()).toBe(
      "mode=payment&line_items%5B0%5D%5Bquantity%5D=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=19900&metadata%5BorderId%5D=o1",
    );
  });

  it("creates a Checkout session with an idempotency key and surfaces Stripe errors", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" }), { status: 200 }));
    const client = stripeClient("sk_test", fetchImpl as unknown as typeof fetch);
    const session = await client.createCheckoutSession({
      mode: "payment",
      productName: "Baseline",
      amountCents: 19900,
      customerEmail: "owner@clinic.example",
      clientReferenceId: "order-1",
      metadata: { orderId: "order-1" },
      successUrl: "https://app.example/ok",
      cancelUrl: "https://app.example/cancel",
      idempotencyKey: "checkout-order-1",
    });
    expect(session).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toBe("checkout-order-1");
    const params = new URLSearchParams(String(init!.body));
    expect(params.get("customer_creation")).toBe("always");
    expect(params.get("payment_intent_data[metadata][orderId]")).toBe("order-1");

    const failing = stripeClient("sk_test", (async () => new Response(JSON.stringify({ error: { message: "No such customer", code: "resource_missing" } }), { status: 400 })) as unknown as typeof fetch);
    await expect(failing.refund("pi_1")).rejects.toMatchObject({ name: "StripeError", status: 400, code: "resource_missing" });
  });
});
