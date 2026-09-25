import { z } from "zod";
import { staffForApi } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";
import { runTaskAction, TaskActionSchema } from "@/lib/shopper/admin";
import { liveShopperDeps } from "@/lib/shopper/deps";

const Body = z.intersection(TaskActionSchema, z.object({ minutesSpent: z.number().int().min(0).max(600).optional() }));

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await staffForApi(request);
  if (staff instanceof Response) return staff;
  const parsed = await parseBody(request, Body, 10_000);
  if ("response" in parsed) return parsed.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(404, "Task not found.");
  const res = await runTaskAction(await liveShopperDeps(), staff, id, parsed.data);
  return res.ok ? json({ ok: true }) : error(res.status, res.message);
}
