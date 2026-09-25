import { ACCOUNT_COOKIE, STAFF_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";

export async function POST() {
  const res = json({ ok: true });
  res.cookies.delete(STAFF_COOKIE);
  res.cookies.delete(ACCOUNT_COOKIE);
  return res;
}
