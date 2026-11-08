import { timingSafeEqual } from "node:crypto";
import { runMaintenance } from "@/lib/server/maintenance";
import { HttpError, json, route } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, "Scheduled maintenance is not configured");
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) throw new HttpError(401, "Unauthorized");
  return json(await runMaintenance());
});
