import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { config } from "./config";
import { createToken, verifyToken } from "./tokens";

// Passwordless sign-in (SPEC.md §6.1): a one-time link by email sets a signed,
// HttpOnly session cookie. Staff roles come from ADMIN_EMAILS and VA_EMAILS and are
// re-checked on every request, so removing someone from the list signs them out.

export type StaffRole = "admin" | "va";
export interface Staff {
  email: string;
  role: StaffRole;
}

export const STAFF_COOKIE = "cgs_staff";
export const ACCOUNT_COOKIE = "cgs_account";
const STAFF_SESSION_SECONDS = 12 * 60 * 60;
const ACCOUNT_SESSION_SECONDS = 30 * 24 * 60 * 60;

const b64 = (s: string) => Buffer.from(s.trim().toLowerCase()).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString();

export function staffRole(email: string): StaffRole | null {
  const e = email.trim().toLowerCase();
  const { admins, vas } = config.staff();
  return admins.includes(e) ? "admin" : vas.includes(e) ? "va" : null;
}

/** The one-time sign-in link token for a staff email. */
export const staffLinkToken = (email: string) => createToken("admin", b64(email));
export const emailFromStaffLink = (token: string | null | undefined) => {
  const s = verifyToken(token, "admin");
  return s ? unb64(s) : null;
};

export const staffSessionToken = (email: string) => createToken("session", `staff:${b64(email)}`, Date.now(), undefined, STAFF_SESSION_SECONDS);
export const accountSessionToken = (leadId: string) => createToken("session", `lead:${leadId}`, Date.now(), undefined, ACCOUNT_SESSION_SECONDS);

export function staffFromSession(token: string | null | undefined): Staff | null {
  const subject = verifyToken(token, "session");
  if (!subject?.startsWith("staff:")) return null;
  const email = unb64(subject.slice(6));
  const role = staffRole(email);
  return role ? { email, role } : null;
}

export function leadFromSession(token: string | null | undefined): string | null {
  const subject = verifyToken(token, "session");
  return subject?.startsWith("lead:") ? subject.slice(5) : null;
}

export async function getStaff(): Promise<Staff | null> {
  return staffFromSession((await cookies()).get(STAFF_COOKIE)?.value);
}

export async function getAccountLeadId(): Promise<string | null> {
  return leadFromSession((await cookies()).get(ACCOUNT_COOKIE)?.value);
}

export function sessionCookie(name: string, value: string, maxAgeSeconds: number) {
  return { name, value, httpOnly: true, secure: config.isProduction(), sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}
export const staffCookie = (email: string) => sessionCookie(STAFF_COOKIE, staffSessionToken(email), STAFF_SESSION_SECONDS);
export const accountCookie = (leadId: string) => sessionCookie(ACCOUNT_COOKIE, accountSessionToken(leadId), ACCOUNT_SESSION_SECONDS);

/**
 * Blocks cross-site form posts to signed-in endpoints: the browser's Origin must be
 * our own site. (Session cookies are also SameSite=Lax.)
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  return origin === new URL(config.siteUrl()).origin;
}

/** For console API routes: the signed-in staff member, or an error response. */
export async function staffForApi(request: Request, role?: StaffRole): Promise<Staff | Response> {
  const staff = await getStaff();
  const deny = (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json" } });
  if (!staff) return deny(401, "Please sign in again.");
  if (request.method !== "GET" && !sameOrigin(request)) return deny(403, "Cross-site request blocked.");
  if (role === "admin" && staff.role !== "admin") return deny(403, "Only an admin can do that.");
  return staff;
}

/** For console pages: the signed-in staff member, or a redirect to sign in. */
export async function requireStaff(role?: StaffRole): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/admin/sign-in");
  if (role === "admin" && staff.role !== "admin") notFound();
  return staff;
}
