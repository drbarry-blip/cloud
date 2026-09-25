import { VerifyButton } from "./VerifyButton";

export const metadata = { title: "Sign in" };

export default async function StaffVerify({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <div className="narrow" style={{ margin: "0 auto" }}>
      <section className="hero">
        <h1>Sign in to the console</h1>
      </section>
      <div className="card">
        <VerifyButton endpoint="/api/auth/staff-verify" token={t ?? null} next="/admin" label="Sign in" />
      </div>
    </div>
  );
}
