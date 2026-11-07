import { requireAdmin } from "@/lib/server/auth";
import { createTrack, createTrackSchema } from "@/lib/server/catalog";
import { json, readJson, route } from "@/lib/server/http";

/** Step 2 of an upload: verify the uploaded objects and create the track. */
export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  const input = createTrackSchema.parse(await readJson(req));
  const track = await createTrack(input, admin.uid);
  return json({ track }, { status: 201 });
});
