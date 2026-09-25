import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { getStaff } from "@/lib/auth";

export const metadata: Metadata = { title: { default: "Console", template: "%s | Console" }, robots: { index: false, follow: false } };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  return (
    <div className="container">
      {staff ? (
        <nav className="console-nav" aria-label="Console">
          <Link href="/admin">Queue</Link>
          <Link href="/admin/tests">Tests</Link>
          {staff.role === "admin" ? <Link href="/admin/numbers">Numbers</Link> : null}
          <span className="who">
            {staff.email} ({staff.role === "admin" ? "Admin" : "VA"})
          </span>
          <ActionButton endpoint="/api/auth/sign-out" body={{}} label="Sign out" redirectTo="/admin/sign-in" />
        </nav>
      ) : null}
      {children}
    </div>
  );
}
