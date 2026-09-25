import { z } from "zod";
import { clientIp, error, json, parseBody } from "@/lib/http";
import { takeDaily } from "@/lib/rate-limit";
import { discoverClinicContact } from "@/lib/shopper/discover";
import { getStore } from "@/lib/store";

const Body = z.object({ website: z.string().trim().min(4).max(300) });

/** Finds contact forms and public email addresses on the clinic's website. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  if (!(await takeDaily(await getStore(), "shopper-discover:ip", clientIp(request), 20))) return error(429, "Too many website checks today. Please enter the details by hand.");
  return json(await discoverClinicContact(parsed.data.website));
}
