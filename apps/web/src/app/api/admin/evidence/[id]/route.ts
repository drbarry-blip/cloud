import { z } from "zod";
import { staffForApi } from "@/lib/auth";
import { error } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";

/** Evidence files (form screenshots) for the console. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await staffForApi(request);
  if (staff instanceof Response) return staff;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return error(404, "Not found.");
  const file = await (await liveShopperDeps()).repo.getEvidence(id);
  if (!file) return error(404, "Not found.");
  return new Response(Buffer.from(file.data), { headers: { "Content-Type": file.contentType, "Cache-Control": "private, no-store" } });
}
