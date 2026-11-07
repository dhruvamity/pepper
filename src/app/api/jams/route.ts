import { requireUser } from "@/lib/server/auth";
import { json, readJson, route } from "@/lib/server/http";
import { startJam, startJamBody } from "@/lib/server/jam";

export const POST = route(async (req) => {
  const { uid, name } = await requireUser(req);
  const input = startJamBody.parse(await readJson(req));
  return json(await startJam({ uid, name }, input), { status: 201 });
});
