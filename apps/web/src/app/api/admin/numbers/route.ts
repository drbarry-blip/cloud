import { normalizeUsPhone } from "@cgs/core";
import { z } from "zod";
import { staffForApi } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), number: z.string().max(40) }),
  z.object({ action: z.literal("retire"), e164: z.string().max(20) }),
]);

/** The persona phone number pool (numbers are bought in Twilio, then added here). */
export async function POST(request: Request) {
  const staff = await staffForApi(request, "admin");
  if (staff instanceof Response) return staff;
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const { repo } = await liveShopperDeps();
  if (parsed.data.action === "add") {
    const e164 = normalizeUsPhone(parsed.data.number);
    if (!e164) return error(400, "Enter a US phone number.");
    const added = await repo.addNumber(e164);
    if (!added) return error(409, "That number is already in the pool.");
    await repo.audit(`email:${staff.email}`, "number.added", { type: "phone_number", id: e164 }, {});
    return json({ ok: true });
  }
  const updated = await repo.setNumberStatus(parsed.data.e164, "retired");
  if (!updated) return error(404, "Number not found.");
  await repo.audit(`email:${staff.email}`, "number.retired", { type: "phone_number", id: parsed.data.e164 }, {});
  return json({ ok: true });
}
