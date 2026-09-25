import { VerifyButton } from "../../admin/verify/VerifyButton";

export const metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default async function AccountVerify({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  return (
    <div className="container narrow">
      <section className="hero">
        <h1>Sign in to your account</h1>
      </section>
      <div className="card">
        <VerifyButton endpoint="/api/auth/account-verify" token={t ?? null} next="/account" label="Sign in" />
      </div>
    </div>
  );
}
