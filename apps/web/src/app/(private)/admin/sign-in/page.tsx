import { redirect } from "next/navigation";
import { SignInForm } from "@/components/SignInForm";
import { getStaff } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function StaffSignIn() {
  if (await getStaff()) redirect("/admin");
  return (
    <div className="narrow" style={{ margin: "0 auto" }}>
      <section className="hero">
        <h1>Operations console</h1>
        <p className="lead">For our team only. We&apos;ll email you a one-time link.</p>
      </section>
      <div className="card">
        <SignInForm endpoint="/api/auth/staff-link" hint="Use the address on the team list." />
      </div>
    </div>
  );
}
