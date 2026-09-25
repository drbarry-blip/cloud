import Link from "next/link";
import { connection } from "next/server";
import { config } from "@/lib/config";

export default async function TestClinicHome() {
  await connection();
  const { email, phone } = config.testClinic();
  return (
    <>
      <section className="hero">
        <p className="eyebrow">Glow Test Clinic · Austin, TX</p>
        <h1>Botox, fillers, and laser hair removal</h1>
        <p className="lead">Natural-looking results from experienced injectors. New patients welcome.</p>
        <p>
          <Link className="btn btn-primary" href="/test-clinic/contact">
            Request a consultation
          </Link>
        </p>
      </section>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Contact us</h2>
        <p style={{ margin: 0 }}>
          {phone ? <a href={`tel:${phone}`}>{phone}</a> : "Phone coming soon"}
          {email ? (
            <>
              {" "}
              · <a href={`mailto:${email}`}>{email}</a>
            </>
          ) : null}
        </p>
        <p className="small muted">Monday to Friday, 9 am to 5 pm.</p>
      </div>
    </>
  );
}
