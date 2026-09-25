import "server-only";
import { BRAND } from "../brand";
import type { OutgoingEmail } from "../email/mailer";
import { renderEmail } from "../email/templates";

// Transactional emails for the Secret Shopper. They never reveal inquiry times,
// persona names, or anything else that could tip off a front desk.

type Email = Omit<OutgoingEmail, "to">;
const BUYER = "You're getting this because you ordered a Secret Shopper test.";

export function orderPaidEmail(p: { clinicName: string; amount: string; statusUrl: string; confirmUrl: string | null }): Email {
  const next = p.confirmUrl
    ? {
        text: "One step left: confirm your email address. Because it matches your clinic's website, that also verifies you manage the clinic, and we'll schedule your test right away.",
        link: { label: "Confirm and start my test", href: p.confirmUrl },
      }
    : {
        text: "Next, we verify that you own or manage the clinic. This protects clinics from fake leads sent by someone else. Our team usually finishes within one business day. To speed it up, you can have a code sent to the clinic's public email address from your order page.",
        link: { label: "View your order", href: p.statusUrl },
      };
  return renderEmail(
    `Order confirmed: Secret Shopper for ${p.clinicName}`,
    [
      { text: `Thanks! We received your payment of ${p.amount} for a Secret Shopper Baseline Test for ${p.clinicName}.` },
      next,
      { text: "We never share exact inquiry times with anyone, so no one at the clinic can be tipped off. You'll get the test dates once it's scheduled." },
    ],
    { kind: "transactional", reason: BUYER },
  );
}

export function clinicCodeEmail(p: { clinicName: string; code: string }): Email {
  return renderEmail(
    `Verification code for ${p.clinicName}`,
    [
      { text: `Someone who manages ${p.clinicName} asked to connect the clinic to their ${BRAND.name} account.` },
      { text: `Their verification code is: ${p.code}\n\nIt expires in 48 hours. Please pass it to your clinic's owner or manager.` },
      { text: "If no one at your clinic asked for this, you can ignore this email. Nothing happens without the code." },
    ],
    { kind: "transactional", reason: "You're getting this because this address is listed as your clinic's public email." },
  );
}

export function testScheduledEmail(p: { clinicName: string; dates: string; statusUrl: string }): Email {
  return renderEmail(
    `Your Secret Shopper test runs ${p.dates}`,
    [
      { text: `You're verified, and your Secret Shopper test for ${p.clinicName} is scheduled. It runs ${p.dates}.` },
      { text: "Please keep the dates to yourself so your team responds the way it normally would. We never share exact times, even with you." },
      { text: "Your report arrives by email when the test ends. If the clinic has an unexpected closure, let us know from your order page and we'll reschedule.", link: { label: "View your order", href: p.statusUrl } },
    ],
    { kind: "transactional", reason: BUYER },
  );
}

export function verificationFailedEmail(p: { clinicName: string; refunded: boolean }): Email {
  return renderEmail(
    `We couldn't verify ${p.clinicName}`,
    [
      { text: `We weren't able to confirm that you own or manage ${p.clinicName}, so we can't run a Secret Shopper test for it.` },
      { text: p.refunded ? "We've issued a full refund to your original payment method. It usually shows up within 5–10 business days." : "Your order has been cancelled and you won't be charged." },
      { text: "If you think this is a mistake, just reply to this email." },
    ],
    { kind: "transactional", reason: BUYER },
  );
}

export function opsAlertEmail(p: { title: string; lines: string[]; url: string }): Email {
  return renderEmail(`[Ops] ${p.title}`, [{ text: p.lines.join("\n") }, { text: "Open the console:", link: { label: "Open task", href: p.url } }], {
    kind: "transactional",
    reason: "You're getting this because you're on the operations team.",
  });
}
