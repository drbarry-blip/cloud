import { z } from "zod";
import { emailFromStaffLink, staffCookie, staffRole } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";

const Body = z.object({ token: z.string().max(500) });

/** Completes staff sign-in (a button click, so email link scanners can't sign anyone in). */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const email = emailFromStaffLink(parsed.data.token);
  if (!email || !staffRole(email)) return error(400, "This sign-in link is invalid or has expired.");
  const res = json({ ok: true });
  res.cookies.set(staffCookie(email));
  return res;
}
