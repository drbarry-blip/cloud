import type { ClinicType } from "../playbook/schema";
import type { ScriptId } from "../playbook/shopper-schema";

// Common US first and last names, varied. No public figures: names are generic
// and combined at random; the admin console shows each persona before use.
const FEMALE = ["Jessica", "Ashley", "Amanda", "Sarah", "Jennifer", "Emily", "Megan", "Lauren", "Rachel", "Nicole", "Stephanie", "Heather", "Danielle", "Kayla", "Maria", "Andrea", "Vanessa", "Monica", "Tiffany", "Erica", "Christina", "Alyssa", "Brianna", "Natalie", "Rebecca", "Priya", "Mei", "Aaliyah", "Gabriela", "Lindsay"];
const MALE = ["Michael", "Chris", "Matt", "Josh", "David", "Daniel", "James", "Ryan", "Andrew", "Justin", "Brandon", "Kevin", "Eric", "Jason", "Tyler", "Nick", "Anthony", "Marcus", "Carlos", "Derek", "Greg", "Scott", "Brian", "Travis", "Jorge", "Raj", "Kenji", "Andre", "Luis", "Sean"];
const LAST = ["Johnson", "Miller", "Davis", "Garcia", "Rodriguez", "Martinez", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Hill", "Green", "Adams", "Baker", "Nelson", "Carter", "Mitchell", "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Patel", "Nguyen", "Kim", "Chen", "Reyes", "Flores", "Rivera", "Brooks", "Foster", "Hayes"];

export interface Persona {
  firstName: string;
  lastName: string;
  sex: "male" | "female";
  email: string;
}

export interface PersonaPlan extends Persona {
  script: ScriptId;
  serviceId: string;
  serviceName: string;
  sensitive: boolean;
  subject: string;
  message: string;
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

/** A fictional person with a unique address on one of the persona domains. */
export function generatePersona(
  random: () => number,
  opts: { sex?: "male" | "female" | "any"; domains: readonly string[]; taken: ReadonlySet<string>; avoidNames?: readonly string[] },
): Persona {
  if (opts.domains.length === 0) throw new Error("At least one persona email domain is required");
  const avoid = new Set((opts.avoidNames ?? []).map((n) => n.toLowerCase()));
  for (let attempt = 0; attempt < 200; attempt++) {
    const sex = opts.sex === "male" || opts.sex === "female" ? opts.sex : random() < 0.5 ? "female" : "male";
    const firstName = pick(sex === "female" ? FEMALE : MALE, random);
    const lastName = pick(LAST, random);
    if (avoid.has(firstName.toLowerCase()) || avoid.has(lastName.toLowerCase())) continue;
    const suffix = String(10 + Math.floor(random() * 89));
    const email = `${firstName}.${lastName}${suffix}@${pick(opts.domains, random)}`.toLowerCase();
    if (!opts.taken.has(email)) return { firstName, lastName, sex, email };
  }
  throw new Error("Couldn't generate a unique persona address");
}

const SUBJECTS = ["Question about {service}", "New patient question", "Quick question", "{service} question", "Appointment question"];

function shortService(name: string): string {
  const first = name.split(/\s*[/(]/)[0]!.trim();
  return name.includes("/") ? first : first.charAt(0).toLowerCase() + first.slice(1);
}

/**
 * Plans the personas for one test: which service each asks about, who they are,
 * and what they write. Each persona asks about a different service where possible.
 */
export function planPersonas(
  random: () => number,
  input: {
    clinicType: ClinicType;
    scripts: readonly ScriptId[];
    serviceIds: readonly string[];
    domains: readonly string[];
    takenEmails: ReadonlySet<string>;
    avoidNames?: readonly string[];
  },
): PersonaPlan[] {
  // In the order given, so callers can rotate services from test to test.
  const services = input.serviceIds.flatMap((id) => input.clinicType.services.filter((s) => s.id === id));
  if (services.length === 0) throw new Error("Pick at least one service to test");
  const taken = new Set(input.takenEmails);
  const usedServices: string[] = [];
  const plans: PersonaPlan[] = [];

  for (const script of input.scripts) {
    // Prefer a service not used yet in this test that has a message for this script.
    const candidates = services.filter((s) => input.clinicType.persona_inquiries.some((q) => q.service === s.id && q.script === script));
    const fresh = candidates.filter((s) => !usedServices.includes(s.id));
    const service = fresh[0] ?? candidates[0] ?? services.find((s) => !usedServices.includes(s.id)) ?? services[0]!;
    usedServices.push(service.id);

    const inquiries = input.clinicType.persona_inquiries.filter((q) => q.service === service.id);
    const inquiry = inquiries.find((q) => q.script === script) ?? inquiries[0] ?? input.clinicType.persona_inquiries.find((q) => q.script === script);
    if (!inquiry) throw new Error(`No persona message for ${service.id}`);

    const persona = generatePersona(random, { sex: service.persona_sex, domains: input.domains, taken, avoidNames: input.avoidNames });
    taken.add(persona.email);
    const shortName = shortService(service.name);
    const subject = pick(SUBJECTS, random).replace("{service}", shortName);
    plans.push({
      ...persona,
      script,
      serviceId: service.id,
      serviceName: service.name,
      sensitive: service.sensitive,
      subject: subject.charAt(0).toUpperCase() + subject.slice(1),
      message: `${inquiry.message}\n\n${persona.firstName}`,
    });
  }
  return plans;
}
