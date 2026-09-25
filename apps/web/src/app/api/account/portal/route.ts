import { getAccountLeadId, sameOrigin } from "@/lib/auth";
import { error, json } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";

/** Opens Stripe's customer portal (cards, invoices, cancellation). */
export async function POST(request: Request) {
  const leadId = await getAccountLeadId();
  if (!leadId) return error(401, "Please sign in again.");
  if (!sameOrigin(request)) return error(403, "Cross-site request blocked.");
  const deps = await liveShopperDeps();
  if (!deps.stripe) return error(503, "Billing isn't connected in this environment.");
  const subs = await deps.repo.subscriptionsForLead(leadId);
  let customerId = subs.find((s) => s.stripeCustomerId)?.stripeCustomerId ?? null;
  if (!customerId) {
    for (const clinic of await deps.repo.clinicsForLead(leadId)) {
      customerId ??= (await deps.repo.ordersForClinic(clinic.id)).find((o) => o.stripeCustomerId)?.stripeCustomerId ?? null;
    }
  }
  if (!customerId) return error(404, "We couldn't find any billing records for your account.");
  const session = await deps.stripe.createPortalSession(customerId, `${deps.siteUrl}/account`);
  return json({ url: session.url });
}
