export const metadata = { title: "Contact" };

/** A plain HTML form, like most clinic sites: no scripts needed to submit it. */
export default function TestClinicContact() {
  return (
    <>
      <section className="hero">
        <h1>Request a consultation</h1>
        <p className="lead">Tell us what you&apos;re interested in and we&apos;ll get back to you.</p>
      </section>
      <form className="card" action="/api/test-clinic/contact" method="post">
        <div className="field">
          <label htmlFor="first_name">First name</label>
          <input id="first_name" name="first_name" type="text" required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="last_name">Last name</label>
          <input id="last_name" name="last_name" type="text" required maxLength={60} />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" maxLength={30} />
        </div>
        <div className="field">
          <label htmlFor="service">Interested in</label>
          <select id="service" name="service">
            <option value="">Select…</option>
            <option value="botox">Botox / neurotoxin</option>
            <option value="filler">Dermal filler</option>
            <option value="laser">Laser hair removal</option>
            <option value="skin">Facials and peels</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="message">How can we help?</label>
          <textarea id="message" name="message" required maxLength={2000} />
        </div>
        <label className="checkbox" style={{ marginTop: 12 }}>
          <input type="checkbox" name="newsletter" /> <span>Send me specials and news</span>
        </label>
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="submit">
            Send
          </button>
        </div>
      </form>
    </>
  );
}
