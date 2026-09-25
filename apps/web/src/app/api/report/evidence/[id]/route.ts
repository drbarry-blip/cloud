import { z } from "zod";
import { error } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { verifyToken } from "@/lib/tokens";

/** A form screenshot from a delivered report. The report link's token must match the test. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const testId = verifyToken(new URL(request.url).searchParams.get("t"), "report");
  if (!testId || !z.uuid().safeParse(id).success) return error(404, "Not found.");
  const file = await (await liveShopperDeps()).repo.getEvidence(id);
  if (!file || file.testId !== testId) return error(404, "Not found.");
  return new Response(Buffer.from(file.data), { headers: { "Content-Type": file.contentType, "Cache-Control": "private, max-age=3600" } });
}
