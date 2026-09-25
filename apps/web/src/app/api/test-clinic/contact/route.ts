import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/email/mailer";
import { clientIp } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";

const field = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);

/**
 * The test clinic's form handler: forwards each request to TEST_CLINIC_EMAIL the way
 * a real clinic's website notifies its front desk, then shows a thank-you page.
 */
export async function POST(request: Request) {
  const thanks = NextResponse.redirect(new URL("/test-clinic/thanks", config.siteUrl()), 303);
  if (!(await takeDaily(await getStore(), "test-clinic:ip", clientIp(request), 30))) return thanks;
  const form = await request.formData();
  const lines = [
    `Name: ${field(form, "first_name", 60)} ${field(form, "last_name", 60)}`,
    `Email: ${field(form, "email", 254)}`,
    `Phone: ${field(form, "phone", 30) || "(none)"}`,
    `Interested in: ${field(form, "service", 30) || "(not chosen)"}`,
    "",
    field(form, "message", 2000),
  ];
  const to = config.testClinic().email;
  if (to) {
    await sendEmail({ to, subject: "New website inquiry", text: lines.join("\n"), replyTo: field(form, "email", 254) || null }).catch((err: Error) =>
      console.error("[test-clinic] notification not sent:", err.message),
    );
  } else {
    console.info("[test-clinic] inquiry received (set TEST_CLINIC_EMAIL to forward it)");
  }
  return thanks;
}
