import { z } from "zod";
import { staffForApi } from "@/lib/auth";
import { error, json, parseBody } from "@/lib/http";
import { relabelTouch } from "@/lib/shopper/admin";
import { liveShopperDeps } from "@/lib/shopper/deps";

const Body = z.object({ label: z.enum(["personal", "auto_reply", "marketing", "reminder"]) });

/** Corrects how a clinic touch is labeled. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await staffForApi(request);
  if (staff instanceof Response) return staff;
  const parsed = await parseBody(request, Body, 1000);
  if ("response" in parsed) return parsed.response;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(404, "Message not found.");
  const res = await relabelTouch(await liveShopperDeps(), staff, id, parsed.data.label);
  return res.ok ? json({ ok: true }) : error(res.status, res.message);
}
