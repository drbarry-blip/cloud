import { z } from "zod";
import { staffForApi } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";
import { cancelTest } from "@/lib/shopper/admin";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { gradeShopperTest } from "@/lib/shopper/grade";
import { scheduleTest } from "@/lib/shopper/schedule";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), refund: z.enum(["full", "none"]) }),
  z.object({ action: z.literal("regrade") }),
  z.object({ action: z.literal("schedule") }),
]);

/** Admin actions on a whole test. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await staffForApi(request, "admin");
  if (staff instanceof Response) return staff;
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(404, "Test not found.");
  const deps = await liveShopperDeps();
  const input = parsed.data;
  if (input.action === "cancel") {
    const res = await cancelTest(deps, staff, id, input.refund);
    return res.ok ? json({ ok: true }) : error(res.status, res.message);
  }
  const test = await deps.repo.getTest(id);
  if (!test) return error(404, "Test not found.");
  if (input.action === "regrade") {
    if (!["grading", "qa", "delivered"].includes(test.status)) return error(409, "Only finished tests can be graded.");
    await gradeShopperTest(deps, id);
    await deps.repo.audit(`email:${staff.email}`, "test.regraded", { type: "test", id }, {});
    return json({ ok: true });
  }
  const res = await scheduleTest(deps, id);
  return res.ok ? json({ ok: true }) : error(409, res.reason);
}
