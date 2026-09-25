import { z } from "zod";
import { config } from "@/lib/config";
import { error } from "@/lib/http";
import { liveShopperDeps } from "@/lib/shopper/deps";
import { verifyToken } from "@/lib/tokens";

/**
 * Streams a voicemail recording from Twilio for a report. The audio stays at Twilio;
 * this checks the report token and that the call belongs to that test.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const testId = verifyToken(new URL(request.url).searchParams.get("t"), "report");
  const twilio = config.twilio();
  if (!testId || !twilio || !z.uuid().safeParse(id).success) return error(404, "Not found.");
  const { repo } = await liveShopperDeps();
  const event = await repo.getInbound(id);
  const assignment = event?.assignmentId ? await repo.getAssignment(event.assignmentId) : null;
  if (!event || !assignment || assignment.testId !== testId || event.phiQuarantined || !event.recordingUrl) return error(404, "Not found.");
  const url = new URL(event.recordingUrl);
  if (url.protocol !== "https:" || url.hostname !== "api.twilio.com") return error(404, "Not found.");
  const res = await fetch(`${url.toString().replace(/\.(?:mp3|wav)$/, "")}.mp3`, {
    headers: { Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64")}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) return error(502, "The recording isn't available right now.");
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
}
