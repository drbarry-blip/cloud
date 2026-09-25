import "server-only";
import type { Playbook } from "@cgs/core";
import { config } from "../config";
import { getDb } from "../db";
import { sendEmail, type OutgoingEmail } from "../email/mailer";
import { getPlaybook } from "../playbook";
import { getStore, type Store } from "../store";
import { stripeClient, type StripeClient } from "../stripe";
import { ShopperRepo } from "./repo";

/** Everything the Secret Shopper workflows touch, injectable for tests. */
export interface ShopperDeps {
  repo: ShopperRepo;
  store: Store;
  playbook: Playbook;
  now: () => Date;
  sendEmail: (m: OutgoingEmail) => Promise<void>;
  stripe: StripeClient | null;
  personaDomains: () => string[];
  siteUrl: string;
  /** Development only: a fake checkout page stands in for Stripe. */
  allowSimulatedCheckout: boolean;
  /** Where to send alerts about new ops tasks; null logs them instead. */
  opsEmail: string | null;
}

export async function liveShopperDeps(): Promise<ShopperDeps> {
  const stripe = config.stripe();
  return {
    repo: new ShopperRepo(await getDb()),
    store: await getStore(),
    playbook: getPlaybook(),
    now: () => new Date(),
    sendEmail,
    stripe: stripe ? stripeClient(stripe.secretKey) : null,
    personaDomains: config.personaDomains,
    siteUrl: config.siteUrl(),
    allowSimulatedCheckout: !config.isProduction(),
    opsEmail: config.opsAlertEmail() ?? config.staff().admins[0] ?? null,
  };
}

/** Sends an email without letting a mail outage break the workflow that triggered it. */
export async function trySend(deps: ShopperDeps, message: OutgoingEmail, what: string): Promise<boolean> {
  try {
    await deps.sendEmail(message);
    return true;
  } catch (err) {
    console.error(`[shopper] ${what} email not sent:`, (err as Error).message);
    return false;
  }
}
